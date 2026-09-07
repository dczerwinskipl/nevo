import { resolve } from 'node:path';
import { loadChange } from '../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../infrastructure/paths.mjs';
import { loadChangeViewConfig } from './change-view-config.mjs';
import { createGitHubPullRequestProvider } from './github.mjs';

function publicReference(reference) {
  return {
    provider: reference.provider,
    baseUrl: reference.base_url,
    repository: reference.repository,
    number: reference.number,
  };
}

function sourceDirectory(source, activeDir, archiveDir) {
  if (source === 'active') return activeDir;
  if (source === 'archive') return archiveDir;
  return null;
}

/** Find one change's own `pull_requests` reference by number, or `null`. */
function findPullRequestReference(change, number) {
  return (change.pull_requests || []).find((reference) => Number(reference.number) === Number(number)) || null;
}

function resolvePullRequestLookup({ source, slug, number, activeDir, archiveDir }) {
  let baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
  let change = loadChange(slug, baseDir);
  if (!change) {
    const fallbackSource = source === 'active' ? 'archive' : 'active';
    const fallbackBaseDir = sourceDirectory(fallbackSource, activeDir, archiveDir);
    if (fallbackBaseDir) {
      change = loadChange(slug, fallbackBaseDir);
    }
  }
  if (!change) return null;
  const reference = findPullRequestReference(change, number);
  if (!reference) return null;
  return { change, reference };
}

/**
 * The pull-requests capability: one coherent API over the dashboard's PR
 * subsystem. GitHub is the only real source today — this deliberately
 * composes a single provider instance directly, rather than a registry
 * keyed by provider id, since there is nothing to select between at
 * runtime. A `reference.provider` that doesn't match the configured
 * provider's `id` (e.g. a hypothetical future non-GitHub reference) still
 * degrades to `{ availability: 'unsupported' }` per-reference, exactly as
 * the previous registry-backed lookup did.
 *
 * Filesystem context derives hierarchically from `root`:
 * `root` -> `specsDir` (<root>/specs) -> `activeDir` / `archiveDir`.
 * Explicit leaf overrides (`activeDir`, `archiveDir`) remain supported.
 */
export function createPullRequestService({
  provider = createGitHubPullRequestProvider(),
  root,
  specsDir,
  activeDir,
  archiveDir,
} = {}) {
  const resolvedRoot = root ?? REPOSITORY_ROOT;
  const resolvedSpecsDir = specsDir ?? resolve(resolvedRoot, 'specs');
  const resolvedActiveDir = activeDir ?? resolve(resolvedSpecsDir, 'active');
  const resolvedArchiveDir = archiveDir ?? resolve(resolvedSpecsDir, 'archive');

  async function resolveReferences(references) {
    return Promise.all(
      references.map(async (reference) => {
        if (reference.provider !== provider.id) {
          return {
            availability: 'unsupported',
            reference: publicReference(reference),
            message: `Provider '${reference.provider}' is not supported yet.`,
          };
        }
        try {
          return await provider.load(resolvedRoot, reference);
        } catch {
          return {
            availability: 'error',
            reference: publicReference(reference),
            message: 'Unable to load pull request details.',
          };
        }
      }),
    );
  }

  async function loadPullRequests({ source, slug }) {
    let baseDir = sourceDirectory(source, resolvedActiveDir, resolvedArchiveDir);
    if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
    let actualSource = source;
    let change = loadChange(slug, baseDir);
    if (!change) {
      const fallbackSource = source === 'active' ? 'archive' : 'active';
      const fallbackBaseDir = sourceDirectory(fallbackSource, resolvedActiveDir, resolvedArchiveDir);
      if (fallbackBaseDir) {
        const fallbackChange = loadChange(slug, fallbackBaseDir);
        if (fallbackChange) {
          change = fallbackChange;
          baseDir = fallbackBaseDir;
          actualSource = fallbackSource;
        }
      }
    }
    if (!change) return null;

    const references = change.pull_requests || [];
    return {
      id: change.id || change._slug,
      slug: change._slug,
      source: actualSource,
      pullRequests: references.length ? await resolveReferences(references) : [],
    };
  }

  async function loadFiles({ source, slug, number }) {
    const lookup = resolvePullRequestLookup({
      source,
      slug,
      number,
      activeDir: resolvedActiveDir,
      archiveDir: resolvedArchiveDir,
    });
    if (!lookup || lookup.reference.provider !== provider.id) return null;

    const { changeView, generatedFiles } = loadChangeViewConfig({ repoRoot: resolvedRoot });
    const files = await provider.loadFiles(resolvedRoot, lookup.reference);
    return { number: Number(number), files, changeView, generatedFiles };
  }

  async function loadFileDiffs({ source, slug, number, paths, headSha }) {
    const lookup = resolvePullRequestLookup({
      source,
      slug,
      number,
      activeDir: resolvedActiveDir,
      archiveDir: resolvedArchiveDir,
    });
    if (!lookup || lookup.reference.provider !== provider.id) return null;

    const diffs = await provider.loadFileDiffs(resolvedRoot, lookup.reference, paths, headSha);
    return { number: Number(number), headSha, diffs };
  }

  async function loadFullDiff({ source, slug, number }) {
    const lookup = resolvePullRequestLookup({
      source,
      slug,
      number,
      activeDir: resolvedActiveDir,
      archiveDir: resolvedArchiveDir,
    });
    if (!lookup || lookup.reference.provider !== provider.id) return null;

    const result = await provider.loadFullDiff(resolvedRoot, lookup.reference);
    return { number: Number(number), ...result };
  }

  return { loadPullRequests, loadFiles, loadFileDiffs, loadFullDiff };
}
