import { requireChangeAnywhere, ROOT } from '../store.mjs';
import * as git from '../../lib/git.mjs';
import * as github from '../../lib/github.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

export function requirePrForChange(changeSlug, gitRoot = ROOT) {
  requireChangeAnywhere(changeSlug);
  const branch = git.getCurrentBranch(gitRoot);
  const pr = github.getPrForBranch(gitRoot, branch);
  if (!pr) throw new CliError(`No pull request found for branch '${branch}'.`);
  return pr;
}

export function getPrReviewThreads(changeSlug, gitRoot = ROOT) {
  const pr = requirePrForChange(changeSlug, gitRoot);
  const threads = github.getReviewThreads(gitRoot, pr.number);
  threads.sort((a, b) => Number(a.isResolved) - Number(b.isResolved));
  return { change: changeSlug, pr: pr.number, threads };
}

export function resolvePrReviewThread(changeSlug, threadId, options = {}, gitRoot = ROOT) {
  const pr = requirePrForChange(changeSlug, gitRoot);
  let replied = false;
  if (options.reply) {
    const threads = github.getReviewThreads(gitRoot, pr.number);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) throw new CliError(`Thread '${threadId}' not found on PR #${pr.number}.`);
    const firstComment = thread.comments[0];
    if (!firstComment) throw new CliError(`Thread '${threadId}' has no comments to reply to.`);
    github.replyToReviewComment(gitRoot, pr.number, firstComment.databaseId, options.reply);
    replied = true;
  }
  const result = github.resolveReviewThread(gitRoot, threadId);
  return {
    change: changeSlug,
    pr: pr.number,
    threadId,
    replied,
    isResolved: result.isResolved,
  };
}
