import { updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';

const DEFAULT_PULL_REQUEST_BASE_URLS = Object.freeze({
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
});

/**
 * Normalize the durable, provider-neutral identity stored in change.yaml.
 */
export function normalizePullRequestReference(reference, label = 'pull request reference') {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new CliError(`${label} must be an object`);
  }

  const provider = String(reference.provider ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider)) {
    throw new CliError(`${label}.provider must be a lowercase provider id (letters, digits, hyphens)`);
  }

  const rawBaseUrl = String(reference.base_url ?? DEFAULT_PULL_REQUEST_BASE_URLS[provider] ?? '').trim();
  if (!rawBaseUrl) {
    throw new CliError(`${label}.base_url is required for provider '${provider}'`);
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username || parsedBaseUrl.password
    || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL without credentials, query, or fragment`);
  }
  const baseUrl = parsedBaseUrl.href.replace(/\/+$/, '');

  let repository = String(reference.repository ?? '').trim().replace(/^\/+|\/+$/g, '');
  repository = repository.replace(/\.git$/i, '');
  const repositoryParts = repository.split('/');
  if (repositoryParts.length < 2
    || repositoryParts.some(part => !part || part === '.' || part === '..')
    || /[\\?#\s]/.test(repository)) {
    throw new CliError(`${label}.repository must be a provider path such as 'owner/repository'`);
  }

  const number = typeof reference.number === 'number'
    ? reference.number
    : Number(String(reference.number ?? '').trim());
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new CliError(`${label}.number must be a positive integer`);
  }

  return { provider, base_url: baseUrl, repository, number };
}

export function pullRequestReferenceKey(reference) {
  const normalized = normalizePullRequestReference(reference);
  return [
    normalized.provider,
    normalized.base_url.toLowerCase(),
    normalized.repository.toLowerCase(),
    normalized.number,
  ].join('|');
}

/**
 * Single structural write path for appending a normalized pull request reference.
 */
export function addPullRequestReference(change, reference) {
  const normalized = normalizePullRequestReference(reference);
  const key = pullRequestReferenceKey(normalized);
  if ((change.pull_requests || []).some(item => pullRequestReferenceKey(item) === key)) {
    return { added: false, reference: normalized };
  }

  updateYamlFile(change._file, doc => {
    if (!doc.has('pull_requests')) doc.set('pull_requests', []);
    const references = doc.get('pull_requests', true);
    if (Array.isArray(references)) {
      references.push(normalized);
      doc.set('pull_requests', references);
    } else if (references && typeof references.add === 'function') {
      references.flow = false;
      references.add(normalized);
    } else {
      throw new CliError(`pull_requests must be an array in ${change._file}`);
    }
  });
  change.pull_requests = [...(change.pull_requests || []), normalized];
  return { added: true, reference: normalized };
}
