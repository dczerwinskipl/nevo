import { requireChangeAnywhere, ROOT } from '../store.mjs';
import * as git from '../../lib/git.mjs';
import * as github from '../../lib/github.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function requirePrForChange(changeSlug) {
  requireChangeAnywhere(changeSlug);
  const branch = git.getCurrentBranch(ROOT);
  const pr = github.getPrForBranch(ROOT, branch);
  if (!pr) throw new CliError(`No pull request found for branch '${branch}'.`);
  return pr;
}

export function handleComments(changeSlug) {
  const pr = requirePrForChange(changeSlug);
  const threads = github.getReviewThreads(ROOT, pr.number);
  threads.sort((a, b) => Number(a.isResolved) - Number(b.isResolved));
  console.log(JSON.stringify({ change: changeSlug, pr: pr.number, threads }, null, 2));
}

export function handleResolveComment(changeSlug, threadId, options = {}) {
  const pr = requirePrForChange(changeSlug);
  if (options.reply) {
    const threads = github.getReviewThreads(ROOT, pr.number);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) throw new CliError(`Thread '${threadId}' not found on PR #${pr.number}.`);
    const firstComment = thread.comments[0];
    if (!firstComment) throw new CliError(`Thread '${threadId}' has no comments to reply to.`);
    github.replyToReviewComment(ROOT, pr.number, firstComment.databaseId, options.reply);
    console.log(`Replied on thread '${threadId}'.`);
  }
  const result = github.resolveReviewThread(ROOT, threadId);
  console.log(`Thread '${threadId}' resolved: ${result.isResolved}`);
}
