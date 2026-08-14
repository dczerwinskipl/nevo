// Thin GitHub CLI (`gh`) wrapper — only the operations tools/specs.mjs finalize
// actually needs. Always execFileSync with an argument array, never shell string
// concatenation. Every function here does real I/O against GitHub; there is no way to
// unit-test this module against a fake GitHub, so keep it thin and push all actual
// decision logic into pure functions elsewhere (see specs/lifecycle.mjs
// validateFinalize) that take already-fetched facts and can be tested without `gh`.

import { execFileSync } from 'node:child_process';
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
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8' });
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

function ownerAndRepo(root) {
  const [owner, repo] = getRepoSlug(root).split('/');
  return { owner, repo };
}

export function isGhAvailable() {
  return resolveGhBinary() !== null;
}

export function getRepoSlug(root) {
  const json = run(root, ['repo', 'view', '--json', 'nameWithOwner']);
  return JSON.parse(json).nameWithOwner; // "owner/repo"
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
    if (/no pull requests found/i.test(message)) return null;
    throw error;
  }
}

// Read-only pull request payload for the local dashboard. Authentication and
// GitHub Enterprise host selection stay inside `gh`; callers receive provider
// responses only and normalize them before anything reaches a browser.
export function getPullRequestDetails(root, reference) {
  const host = apiHost(reference.base_url);
  const endpoint = `repos/${repositoryEndpoint(reference.repository)}/pulls/${reference.number}`;
  const metadata = JSON.parse(run(root, ['api', '--hostname', host, endpoint]));
  const files = parsePaginatedJson(run(root, [
    'api', '--hostname', host, '--paginate', '--slurp', `${endpoint}/files?per_page=100`,
  ]));
  const diff = run(root, [
    'api', '--hostname', host,
    '-H', 'Accept: application/vnd.github.diff',
    endpoint,
  ]);
  return { metadata, files, diff };
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
