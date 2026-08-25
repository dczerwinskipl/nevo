// Thin GitHub CLI (`gh`) wrapper — only the operations tools/specs.mjs finalize
// actually needs. Always execFileSync with an argument array, never shell string
// concatenation. Every function here does real I/O against GitHub; there is no way to
// unit-test this module against a fake GitHub, so keep it thin and push all actual
// decision logic into pure functions elsewhere (see specs/lifecycle.mjs
// validateFinalize) that take already-fetched facts and can be tested without `gh`.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Resolves once per process — a long-running Claude Code session (or any long-lived
// shell) can predate `gh` being added to PATH (e.g. installed mid-session), and a
// process doesn't pick up PATH changes made after it started. Bare `gh` is tried first
// (works for everyone whose PATH is already correct); these are only a fallback for
// the specific, real case this repository hit: `gh` installed and working in a fresh
// terminal, but invisible to an already-running process. Windows-only, matching this
// repository's documented primary environment (see CLAUDE.md).
const WINDOWS_GH_FALLBACK_PATHS = [
  'C:\\Program Files\\GitHub CLI\\gh.exe',
  'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
];

let resolvedGhBinary; // cached after the first successful resolution this process

// Node's synchronous child-process default is only 1 MiB. Large pull requests can
// exceed it with the paginated files payload alone, causing a misleading ENOBUFS
// before the dashboard has a chance to normalize the response. Keep a finite ceiling
// while allowing repository-scale metadata and unified diffs through.
const GH_CLI_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

export class Semaphore {
  constructor(max = 3) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire(signal) {
    if (signal?.aborted) {
      const error = signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    return new Promise((resolvePromise, rejectPromise) => {
      let onAbort;
      const item = () => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        this.current++;
        resolvePromise(() => this.release());
      };
      if (signal) {
        onAbort = () => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          const error = signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted');
          error.name = 'AbortError';
          rejectPromise(error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.queue.push(item);
    });
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }
}

// Bounded concurrency for gh subprocesses (limit = 3).
// Prevents burst requests from exhausting network sockets or failing TLS handshakes.
export const defaultGhSemaphore = new Semaphore(3);

function resolveGhBinary() {
  if (resolvedGhBinary) return resolvedGhBinary;
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf8' });
    resolvedGhBinary = 'gh';
    return resolvedGhBinary;
  } catch {
    // fall through to the fallback paths below
  }
  if (process.platform === 'win32') {
    for (const candidate of WINDOWS_GH_FALLBACK_PATHS) {
      if (existsSync(candidate)) {
        resolvedGhBinary = candidate;
        return resolvedGhBinary;
      }
    }
  }
  return null; // genuinely unavailable — isGhAvailable() reports this, callers check it
}

const PULL_REQUEST_FILES_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions changeType }
      }
    }
  }
}`;

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        totalCount
        nodes { isResolved }
      }
    }
  }
}`;

const REVIEW_THREADS_DETAIL_QUERY = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 20) {
            nodes {
              databaseId
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}`;

const RESOLVE_REVIEW_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

function run(root, args) {
  const binary = resolveGhBinary();
  if (!binary) throw new Error('gh CLI is not available (checked PATH and known Windows install locations).');
  return execFileSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GH_CLI_MAX_BUFFER_BYTES,
  });
}

export async function runAsync(root, args, { op = 'gh', timeout = 60000, semaphore = defaultGhSemaphore, signal } = {}) {
  if (signal?.aborted) {
    const error = signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  }
  const binary = resolveGhBinary();
  if (!binary) throw new Error('gh CLI is not available (checked PATH and known Windows install locations).');
  const queueStart = performance.now();
  const release = await semaphore.acquire(signal);
  const queueMs = Math.round(performance.now() - queueStart);
  const execStart = performance.now();
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const execOptions = {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: GH_CLI_MAX_BUFFER_BYTES,
        timeout,
      };
      if (signal) {
        execOptions.signal = signal;
      }
      execFile(
        binary,
        args,
        execOptions,
        (error, stdout, stderr) => {
          const ghMs = Math.round(performance.now() - execStart);
          if (process.env.DEBUG || process.env.NODE_ENV !== 'production') {
            console.log(`[github] op=${op} queue=${queueMs}ms gh=${ghMs}ms`);
          }
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            rejectPromise(error);
          } else {
            resolvePromise(stdout);
          }
        },
      );
    });
  } finally {
    release();
  }
}

function apiHost(baseUrl) {
  const url = new URL(baseUrl);
  return url.hostname;
}

function repositoryEndpoint(repository) {
  return repository.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function parsePaginatedJson(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return Array.isArray(parsed[0]) ? parsed.flat() : parsed;
}

function isOversizedPullRequestDiff(error) {
  const detail = [error?.message, error?.stdout, error?.stderr].map(value => String(value || '')).join('\n');
  return /(?:HTTP\s+)?406/i.test(detail)
    && /(diff exceeded|maximum number of lines|too_large)/i.test(detail);
}

function ownerAndRepo(root) {
  const [owner, repo] = getRepoSlug(root).split('/');
  return { owner, repo };
}

export function isGhAvailable() {
  return resolveGhBinary() !== null;
}

const repoSlugCache = new Map();

export function getRepoSlug(root) {
  if (repoSlugCache.has(root)) return repoSlugCache.get(root);
  const json = run(root, ['repo', 'view', '--json', 'nameWithOwner']);
  const slug = JSON.parse(json).nameWithOwner; // "owner/repo"
  repoSlugCache.set(root, slug);
  return slug;
}

const repoSlugAsyncInFlight = new Map();

export async function getRepoSlugAsync(root) {
  if (repoSlugCache.has(root)) return repoSlugCache.get(root);
  let pending = repoSlugAsyncInFlight.get(root);
  if (!pending) {
    pending = (async () => {
      try {
        const json = await runAsync(root, ['repo', 'view', '--json', 'nameWithOwner'], { op: 'repo-view' });
        const slug = JSON.parse(json).nameWithOwner;
        repoSlugCache.set(root, slug);
        return slug;
      } finally {
        repoSlugAsyncInFlight.delete(root);
      }
    })();
    repoSlugAsyncInFlight.set(root, pending);
  }
  return await pending;
}

// Returns null if no PR exists for this branch (gh's own "no pull requests found"
// case) — never throws for that, since "no PR yet" is a normal, expected state this
// caller must handle, not an error.
export function getPrForBranch(root, branch) {
  try {
    const json = run(root, ['pr', 'view', branch, '--json', 'number,state,isDraft,url,title,baseRefName']);
    return JSON.parse(json);
  } catch (error) {
    const message = String(error?.stderr || error?.message || '');
    if (/no (?:pull requests|git remotes) found/i.test(message)) return null;
    throw error;
  }
}

export async function getPrForBranchAsync(root, branch, options = {}) {
  try {
    const json = await runAsync(root, ['pr', 'view', branch, '--json', 'number,state,isDraft,url,title,baseRefName'], {
      op: 'pr-view',
      signal: options.signal,
    });
    return JSON.parse(json);
  } catch (error) {
    const message = String(error?.stderr || error?.message || '');
    if (/no (?:pull requests|git remotes) found/i.test(message)) return null;
    throw error;
  }
}

// Read-only pull request payload for the local dashboard. Authentication and
// GitHub Enterprise host selection stay inside `gh`; callers receive provider
// responses only and normalize them before anything reaches a browser.
//
// Split into four narrow calls (area pull-request-file-and-diff-loading, task
// 02) instead of one bundled fetch, so the PR-list route can stay metadata-
// only and the files-manifest route never forces patch expansion upstream.

// One REST call — no files, no diff. What the lightweight PR-list route uses.
export function getPullRequestMetadata(root, reference, execute = run) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  return JSON.parse(execute(root, ['api', '--hostname', host, endpoint]));
}

export async function getPullRequestMetadataAsync(root, reference, execute = runAsync) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  const json = await execute(root, ['api', '--hostname', host, endpoint], { op: 'pr-metadata' });
  return JSON.parse(json);
}

// File manifest via GraphQL's `PullRequest.files` connection — requests only
// path/additions/deletions/changeType, never patch content (GraphQL has no
// patch field to request in the first place, unlike the REST files listing
// below). Paginated at 100 files per page.
export function getPullRequestFiles(root, reference, execute = run) {
  const [owner, repo] = reference.repository.split('/');
  const files = [];
  let after = null;
  for (;;) {
    const args = [
      'api', 'graphql',
      '-f', `query=${PULL_REQUEST_FILES_QUERY}`,
      '-f', `owner=${owner}`,
      '-f', `repo=${repo}`,
      '-F', `pr=${reference.number}`,
    ];
    if (after) args.push('-f', `after=${after}`);
    const json = execute(root, args);
    const page = JSON.parse(json).data.repository.pullRequest.files;
    files.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return files;
}

export async function getPullRequestFilesAsync(root, reference, execute = runAsync) {
  const [owner, repo] = reference.repository.split('/');
  const files = [];
  let after = null;
  for (;;) {
    const args = [
      'api', 'graphql',
      '-f', `query=${PULL_REQUEST_FILES_QUERY}`,
      '-f', `owner=${owner}`,
      '-f', `repo=${repo}`,
      '-F', `pr=${reference.number}`,
    ];
    if (after) args.push('-f', `after=${after}`);
    const json = await execute(root, args, { op: 'pr-files-graphql' });
    const page = JSON.parse(json).data.repository.pullRequest.files;
    files.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return files;
}

// The REST files listing, patches included — GitHub's only surface for patch
// text (GraphQL doesn't expose it). Callers (providers/github.mjs) are
// responsible for caching this per (reference, headSha) so a batch of diff
// requests doesn't repeat this call — this function itself always fetches.
export function getPullRequestFilesWithPatches(root, reference, execute = run) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  return parsePaginatedJson(execute(root, [
    'api', '--hostname', host, '--paginate', '--slurp', `${endpoint}/files?per_page=100`,
  ]));
}

export async function getPullRequestFilesWithPatchesAsync(root, reference, execute = runAsync) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  const json = await execute(root, [
    'api', '--hostname', host, '--paginate', '--slurp', `${endpoint}/files?per_page=100`,
  ], { op: 'pr-files-patches' });
  return parsePaginatedJson(json);
}

// Full raw unified diff — on-demand only, never called by the list/manifest
// routes.
export function getFullDiff(root, reference, execute = run) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  try {
    return execute(root, [
      'api', '--hostname', host,
      '-H', 'Accept: application/vnd.github.diff',
      endpoint,
    ]);
  } catch (error) {
    if (isOversizedPullRequestDiff(error)) return '';
    throw error;
  }
}

export async function getFullDiffAsync(root, reference, execute = runAsync) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  try {
    return await execute(root, [
      'api', '--hostname', host,
      '-H', 'Accept: application/vnd.github.diff',
      endpoint,
    ], { op: 'full-diff' });
  } catch (error) {
    if (isOversizedPullRequestDiff(error)) return '';
    throw error;
  }
}

// Counts review threads (from any reviewer, including bots like GitHub Copilot) that
// are not marked resolved. REST doesn't expose thread-resolution state at all — only
// GraphQL does — so this always goes through `gh api graphql`. Only the first 100
// threads are considered; a PR with more than that is not something this repository's
// single-maintainer workflow expects to hit, but the count would silently undercount
// if it did.
export function getUnresolvedReviewThreadCount(root, prNumber) {
  const { owner, repo } = ownerAndRepo(root);
  const json = run(root, [
    'api', 'graphql',
    '-f', `query=${REVIEW_THREADS_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${repo}`,
    '-F', `pr=${prNumber}`,
  ]);
  const nodes = JSON.parse(json).data.repository.pullRequest.reviewThreads.nodes;
  return nodes.filter(n => !n.isResolved).length;
}

export async function getUnresolvedReviewThreadCountAsync(root, prNumber, options = {}) {
  const slug = await getRepoSlugAsync(root);
  const [owner, repo] = slug.split('/');
  const json = await runAsync(root, [
    'api', 'graphql',
    '-f', `query=${REVIEW_THREADS_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${repo}`,
    '-F', `pr=${prNumber}`,
  ], { op: 'unresolved-threads', signal: options.signal });
  const nodes = JSON.parse(json).data.repository.pullRequest.reviewThreads.nodes;
  return nodes.filter(n => !n.isResolved).length;
}

// Full thread + comment detail (author, body, path/line, and each comment's REST
// `databaseId` for replyToReviewComment) — the read side an agent needs to actually
// evaluate and act on PR feedback, not just count it. Same 100-thread/20-comment
// pagination limit as getUnresolvedReviewThreadCount, for the same reason.
export function getReviewThreads(root, prNumber) {
  const { owner, repo } = ownerAndRepo(root);
  const json = run(root, [
    'api', 'graphql',
    '-f', `query=${REVIEW_THREADS_DETAIL_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${repo}`,
    '-F', `pr=${prNumber}`,
  ]);
  const nodes = JSON.parse(json).data.repository.pullRequest.reviewThreads.nodes;
  return nodes.map(t => ({
    id: t.id,
    isResolved: t.isResolved,
    path: t.path,
    line: t.line,
    comments: t.comments.nodes.map(c => ({
      databaseId: c.databaseId,
      author: c.author?.login ?? 'unknown',
      body: c.body,
      createdAt: c.createdAt,
    })),
  }));
}

// Marks a review thread resolved — the GraphQL node `id` from getReviewThreads, not a
// REST databaseId. This is a write against another party's review conversation
// (possibly a bot's, possibly a human reviewer's); the interactive confirmation this
// needs happens one layer up, in the command that calls it, before it's ever called —
// same split as mergePr below.
export function resolveReviewThread(root, threadId) {
  const json = run(root, [
    'api', 'graphql',
    '-f', `query=${RESOLVE_REVIEW_THREAD_MUTATION}`,
    '-f', `threadId=${threadId}`,
  ]);
  return JSON.parse(json).data.resolveReviewThread.thread;
}

// Replies to one review comment (by its REST databaseId, from getReviewThreads) —
// this is the simple REST reply endpoint, not a GraphQL mutation; GitHub has no
// GraphQL "reply to thread" primitive, only "reply to a specific comment."
export function replyToReviewComment(root, prNumber, commentDatabaseId, body) {
  const { owner, repo } = ownerAndRepo(root);
  const json = run(root, [
    'api', `repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentDatabaseId}/replies`,
    '-f', `body=${body}`,
  ]);
  return JSON.parse(json);
}

// Squash-merges — matches this repository's documented merge strategy
// (docs/development/git-workflow.md § "Merge strategy",
// docs/development/pull-requests.md § "Merge"). Deliberately **no**
// `--delete-branch` (D9, area finalization-and-migration, task 09): branch
// deletion is a separate, later step, gated on a post-merge verification
// check passing — never in the same call as the merge itself, so a failed
// post-merge check still has the branch as a diagnostic anchor. No
// confirmation flag is passed: `gh` only prompts interactively when attached
// to a TTY, and this always runs non-interactively from specs.mjs; the
// interactive confirmation this action actually needs happens one layer up,
// in /nevo-ai:spec-finalize's closed-menu step, before this function is ever
// called.
export function mergePr(root, prNumber) {
  run(root, ['pr', 'merge', String(prNumber), '--squash']);
}

export async function mergePrAsync(root, prNumber, options = {}) {
  await runAsync(root, ['pr', 'merge', String(prNumber), '--squash'], {
    op: 'pr-merge',
    signal: options.signal,
  });
}
