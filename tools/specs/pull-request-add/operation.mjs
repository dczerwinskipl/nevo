import { loadChangeAnywhere } from '../store.mjs';
import { addPullRequestReference } from '../pull-requests.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: record a durable, provider-neutral pull request
 * reference on an active or archived change (D1).
 */
export function addPullRequest(changeSlug, options = {}, directories = {}) {
  const located = loadChangeAnywhere(changeSlug, directories);
  if (!located) throw new CliError(`Change '${changeSlug}' not found in specs/active/ or specs/archive/`);

  const result = addPullRequestReference(located.change, {
    provider: options.provider,
    base_url: options.baseUrl,
    repository: options.repository,
    number: options.number,
  });
  return { ...result, location: located.location };
}
