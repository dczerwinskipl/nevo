import { addPullRequest } from './operation.mjs';

export function handlePullRequestAdd(changeSlug, options = {}, directories = {}) {
  const result = addPullRequest(changeSlug, options, directories);
  const reference = result.reference;
  const identity = `${reference.provider}:${reference.base_url}/${reference.repository}#${reference.number}`;
  console.log(result.added
    ? `Pull request '${identity}' attached to '${changeSlug}' (${result.location}).`
    : `Pull request '${identity}' is already attached to '${changeSlug}' — no changes made.`);
  return result;
}
