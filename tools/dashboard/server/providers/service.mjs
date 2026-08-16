import { ACTIVE_DIR, ARCHIVE_DIR, loadChange } from '../../../specs/service.mjs';
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

export function resolvePullRequestReferences(references, {
  root = REPOSITORY_ROOT,
  registry = createProviderRegistry(),
} = {}) {
  return references.map(reference => {
    const provider = registry.get(reference.provider);
    if (!provider) {
      return {
        availability: 'unsupported',
        reference: publicReference(reference),
        message: `Provider '${reference.provider}' is not supported yet.`,
      };
    }

    try {
      return provider.load(root, reference);
    } catch {
      return {
        availability: 'error',
        reference: publicReference(reference),
        message: 'Unable to load pull request details.',
      };
    }
  });
}

function sourceDirectory(source, activeDir, archiveDir) {
  if (source === 'active') return activeDir;
  if (source === 'archive') return archiveDir;
  return null;
}

export function loadSpecificationPullRequests({
  source,
  slug,
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  root = REPOSITORY_ROOT,
  registry,
} = {}) {
  const baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
  const change = loadChange(slug, baseDir);
  if (!change) return null;

  const references = change.pull_requests || [];
  return {
    id: change.id || change._slug,
    slug: change._slug,
    source,
    pullRequests: references.length
      ? resolvePullRequestReferences(references, { root, registry: registry || defaultRegistry })
      : [],
  };
}

/** Find one change's own `pull_requests` reference by number, or `null`. */
function findPullRequestReference(change, number) {
  return (change.pull_requests || []).find(reference => Number(reference.number) === Number(number)) || null;
}

function resolvePullRequestLookup({ source, slug, number, activeDir, archiveDir }) {
  const baseDir = sourceDirectory(source, activeDir, archiveDir);
  if (!baseDir || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
  const change = loadChange(slug, baseDir);
  if (!change) return null;
  const reference = findPullRequestReference(change, number);
  if (!reference) return null;
  return { change, reference };
}

export function loadSpecificationPullRequestFiles({
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
  try {
    // The per-project changeView/generatedFiles config is delivered here
    // (area changes-grouping-and-filtering: "folded into the task-02
    // files-manifest response" is one of the named implementation options)
    // rather than a separate route, since it's only ever needed alongside
    // the file manifest itself.
    const { changeView, generatedFiles } = loadChangeViewConfig({ repoRoot: root });
    return {
      number: Number(number),
      files: provider.loadFiles(root, lookup.reference),
      changeView,
      generatedFiles,
    };
  } catch {
    return null;
  }
}

export function loadSpecificationPullRequestFileDiffs({
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
  try {
    return {
      number: Number(number),
      headSha,
      diffs: provider.loadFileDiffs(root, lookup.reference, paths, headSha),
    };
  } catch {
    return null;
  }
}

export function loadSpecificationPullRequestFullDiff({
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
  try {
    return { number: Number(number), ...provider.loadFullDiff(root, lookup.reference) };
  } catch {
    return null;
  }
}
