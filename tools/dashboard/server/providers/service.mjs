import { ACTIVE_DIR, ARCHIVE_DIR, loadChange } from '../../../specs/service.mjs';
import { REPOSITORY_ROOT } from '../data.mjs';
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
      ? resolvePullRequestReferences(references, { root, registry: registry || createProviderRegistry() })
      : [],
  };
}
