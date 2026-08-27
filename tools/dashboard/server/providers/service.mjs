import { ACTIVE_DIR, ARCHIVE_DIR, loadChange } from '../../../specs/store.mjs';
import { REPOSITORY_ROOT } from '../data.mjs';
import { loadChangeViewConfig } from '../change-view-config.mjs';
import { createGitHubProvider } from './github.mjs';

function publicReference(reference) {
  return {
    provider: reference.provider,
    baseUrl: reference.base_url,
    repository: reference.repository,
    number: reference.number,
  };
}

export function createProviderRegistry(providers = [createGitHubProvider()]) {
  return new Map(providers.map(provider => [provider.id, provider]));
}

// A module-level singleton, not a fresh registry per call — each provider's
// own file-diff cache (providers/github.mjs) must survive across requests
// within this one long-running dashboard server process, or the whole point
// of caching by (reference, headSha) is lost on the very next batch request.
const defaultRegistry = createProviderRegistry();

export async function resolvePullRequestReferences(references, {
  root = REPOSITORY_ROOT,
  registry = createProviderRegistry(),
} = {}) {
  return Promise.all(references.map(async (reference) => {
    const provider = registry.get(reference.provider);
    if (!provider) {
      return {
        availability: 'unsupported',
        reference: publicReference(reference),
        message: `Provider '${reference.provider}' is not supported yet.`,
      };
    }

    try {
      return await provider.load(root, reference);
    } catch {
      return {
        availability: 'error',
        reference: publicReference(reference),
        message: 'Unable to load pull request details.',
      };
    }
  }));
}

function sourceDirectory(source, activeDir, archiveDir) {
  if (source === 'active') return activeDir;
  if (source === 'archive') return archiveDir;
  return null;
}

export async function loadSpecificationPullRequests({
  source,
  slug,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  root = REPOSITORY_ROOT,
  registry,
} = {}) {
  let baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
  let actualSource = source;
  let change = loadChange(slug, baseDir);
  if (!change) {
    const fallbackSource = source === 'active' ? 'archive' : 'active';
    const fallbackBaseDir = sourceDirectory(fallbackSource, activeDir, archiveDir);
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
    pullRequests: references.length
      ? await resolvePullRequestReferences(references, { root, registry: registry || defaultRegistry })
      : [],
  };
}

/** Find one change's own `pull_requests` reference by number, or `null`. */
function findPullRequestReference(change, number) {
  return (change.pull_requests || []).find(reference => Number(reference.number) === Number(number)) || null;
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

export async function loadSpecificationPullRequestFiles({
  source,
  slug,
  number,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  root = REPOSITORY_ROOT,
  registry = defaultRegistry,
} = {}) {
  const lookup = resolvePullRequestLookup({ source, slug, number, activeDir, archiveDir });
  if (!lookup) return null;
  const provider = registry.get(lookup.reference.provider);
  if (!provider) return null;

  const { changeView, generatedFiles } = loadChangeViewConfig({ repoRoot: root });
  const files = await provider.loadFiles(root, lookup.reference);
  return {
    number: Number(number),
    files,
    changeView,
    generatedFiles,
  };
}

export async function loadSpecificationPullRequestFileDiffs({
  source,
  slug,
  number,
  paths,
  headSha,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  root = REPOSITORY_ROOT,
  registry = defaultRegistry,
} = {}) {
  const lookup = resolvePullRequestLookup({ source, slug, number, activeDir, archiveDir });
  if (!lookup) return null;
  const provider = registry.get(lookup.reference.provider);
  if (!provider) return null;

  const diffs = await provider.loadFileDiffs(root, lookup.reference, paths, headSha);
  return {
    number: Number(number),
    headSha,
    diffs,
  };
}

export async function loadSpecificationPullRequestFullDiff({
  source,
  slug,
  number,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  root = REPOSITORY_ROOT,
  registry = defaultRegistry,
} = {}) {
  const lookup = resolvePullRequestLookup({ source, slug, number, activeDir, archiveDir });
  if (!lookup) return null;
  const provider = registry.get(lookup.reference.provider);
  if (!provider) return null;

  const result = await provider.loadFullDiff(root, lookup.reference);
  return { number: Number(number), ...result };
}
