// Fail-closed source-control commit/push action (D12, D15) — the reference ActionContract
// implementation for this workflow subsystem. Local Git facts/mutations only; a
// remote-provider-specific mutation (e.g. opening a PR) is out of scope for this action —
// `sourceControl.remote` only identifies which provider *would* be used for a future
// provider-specific capability (D12).

import { ActionContract, ActionCheckResult, ActionExecuteResult } from '../contracts.mjs';
import { PreconditionError, WorkflowError } from '../errors.mjs';
import { normalizeSourceControlConfig } from '../definitions/schema.mjs';
import * as git from '../../../lib/git.mjs';

const COMMIT_TITLE_SCHEMA = {
  name: 'commit.title',
  type: 'string',
  required: true,
  description: 'Conventional commit title describing the change',
  constraints: { minLength: 5 },
};

const COMMIT_MESSAGE_SCHEMA = {
  name: 'commit.message',
  type: 'string',
  required: false,
  description: 'Extended commit body',
};

const INCLUDE_SCHEMA = {
  name: 'include',
  type: 'array',
  required: true,
  description: "Explicit file selection array (e.g. ['*'] or ['src/**'])",
};

const EXCLUDE_SCHEMA = {
  name: 'exclude',
  type: 'array',
  required: false,
  description: 'File paths or globs to exclude from staging',
};

// Same shape as tools/specs/lifecycle/recovery.mjs's pathMatchesAllowedPattern, plus a
// bare '*'/'**' "match everything" case — commit-and-push's own `include`/`exclude`
// contract explicitly allows `include: ['*']` (D4/D6), which an allowed_paths-style
// matcher alone does not need to support. Kept local rather than importing that
// unrelated module's internal helper for one extra case.
function matchesFileSelectionPattern(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  if (normalizedPattern === '*' || normalizedPattern === '**') return true;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalized.startsWith(`${prefix}/`) && !normalized.slice(prefix.length + 1).includes('/');
  }
  return normalized === normalizedPattern;
}

function resolveFileSelection(paths, patterns) {
  const normalizedPatterns = (patterns || []).map(p => String(p).trim()).filter(Boolean);
  if (!normalizedPatterns.length) return [];
  return paths.filter(p => normalizedPatterns.some(pattern => matchesFileSelectionPattern(p, pattern)));
}

function shortLog(entries) {
  return entries.map(c => `${c.sha.slice(0, 7)} ${c.subject}`);
}

/**
 * Fail-closed source-control commit/push action. `check(context)` never mutates
 * anything; `execute(inputs, context)` (via `executeValidated`, the `ActionContract`
 * boundary) stages exactly the caller's explicit `include`/`exclude` file selection,
 * commits, and pushes only when `sourceControl.push` is enabled.
 *
 * Expected `context` shape (all optional except `repoRoot`, required whenever
 * `sourceControl.enabled` is true):
 * - `repoRoot` {string} — absolute path to the repository root.
 * - `sourceControl` {object} — raw `sourceControl` config (see
 *   `definitions/schema.mjs`'s `normalizeSourceControlConfig`); omitted/invalid defaults
 *   to fully disabled, matching "no automation" (D12).
 * - `baseBranch` {string} — defaults to `'main'`.
 * - `taskAllowedPaths` {string[]} — the current task's `allowed_paths`, used only to
 *   compute the factual `taskAffectedFiles` context field.
 */
export class CommitAndPushAction extends ActionContract {
  get id() {
    return 'commit-and-push';
  }

  get description() {
    return 'Fail-closed source-control commit and push action requiring explicit file selection.';
  }

  async check(context = {}) {
    const sourceControl = normalizeSourceControlConfig(context.sourceControl);

    if (!sourceControl.enabled) {
      return new ActionCheckResult({
        actionId: this.id,
        requiredInputs: [],
        context: { sourceControl },
        ready: false,
        summary: 'Source control is disabled; commit-and-push is not applicable.',
      });
    }

    if (!context.repoRoot || typeof context.repoRoot !== 'string') {
      throw new WorkflowError(`Action '${this.id}' check(context) requires context.repoRoot when sourceControl is enabled`);
    }

    const repoRoot = context.repoRoot;
    const baseBranch = context.baseBranch || 'main';
    const currentBranch = git.getCurrentBranch(repoRoot);
    const changedFiles = git.getDirtyFiles(repoRoot);
    const dirtyPaths = git.getDirtyPaths(repoRoot);
    const summary = git.getWorkingTreeSummary(repoRoot);
    const stagedFiles = summary.files
      .filter(f => f.status[0] !== ' ' && f.status[0] !== '?')
      .map(f => f.path);
    const taskAllowedPaths = Array.isArray(context.taskAllowedPaths) ? context.taskAllowedPaths : [];
    const taskAffectedFiles = taskAllowedPaths.length
      ? dirtyPaths.filter(p => taskAllowedPaths.some(pattern => matchesFileSelectionPattern(p, pattern)))
      : [];
    const existingCommits = shortLog(git.getCommitsSince(repoRoot, baseBranch, currentBranch));

    const factualContext = {
      changedFiles,
      stagedFiles,
      taskAffectedFiles,
      generatedFiles: [],
      currentBranch,
      baseBranch,
      existingCommits,
    };

    if (sourceControl.push) {
      const unpushed = git.hasUpstream(repoRoot, currentBranch)
        ? git.getCommitsSince(repoRoot, `origin/${currentBranch}`, currentBranch)
        : git.getCommitsSince(repoRoot, baseBranch, currentBranch);
      factualContext.unpushedCommits = shortLog(unpushed);
    }

    return new ActionCheckResult({
      actionId: this.id,
      requiredInputs: [COMMIT_TITLE_SCHEMA, COMMIT_MESSAGE_SCHEMA, INCLUDE_SCHEMA, EXCLUDE_SCHEMA],
      context: factualContext,
      ready: true,
      summary: 'Ready to commit the explicit file selection.',
    });
  }

  async executeValidated(inputs, context = {}) {
    const repoRoot = context.repoRoot;
    if (!repoRoot || typeof repoRoot !== 'string') {
      throw new WorkflowError(`Action '${this.id}' executeValidated(inputs, context) requires context.repoRoot`);
    }

    const title = typeof inputs['commit.title'] === 'string' ? inputs['commit.title'].trim() : '';
    if (!title) {
      throw new PreconditionError(
        `Action '${this.id}' requires non-empty commit.title`,
        [{ field: 'commit.title', message: 'commit.title must be a non-empty string', code: 'REQUIRED_FIELD_MISSING' }],
        this.id
      );
    }

    if (!Array.isArray(inputs.include) || inputs.include.length === 0) {
      throw new PreconditionError(
        `Action '${this.id}' requires an explicit include parameter — it never guesses or stages all dirty files implicitly`,
        [{ field: 'include', message: 'include must be a non-empty array of explicit paths/globs', code: 'REQUIRED_FIELD_MISSING' }],
        this.id
      );
    }

    const dirtyPaths = git.getDirtyPaths(repoRoot);
    const included = resolveFileSelection(dirtyPaths, inputs.include);
    const excluded = new Set(resolveFileSelection(included, inputs.exclude));
    const finalPaths = included.filter(p => !excluded.has(p));

    if (finalPaths.length === 0) {
      throw new PreconditionError(
        `Action '${this.id}': explicit include selection (after exclude) matched no changed files`,
        [{ field: 'include', message: 'include (after applying exclude) matched no changed files', code: 'EMPTY_FILE_SELECTION' }],
        this.id
      );
    }

    const commitMessageBody = typeof inputs['commit.message'] === 'string' ? inputs['commit.message'].trim() : '';
    const fullMessage = commitMessageBody ? `${title}\n\n${commitMessageBody}` : title;

    await git.addAndCommitAsync(repoRoot, finalPaths, fullMessage);
    const sha = git.getCurrentRevision(repoRoot);
    const outputs = { commit: { sha, status: 'completed' } };

    const sourceControl = normalizeSourceControlConfig(context.sourceControl);
    let summaryText = `Committed ${finalPaths.length} file(s) as ${sha.slice(0, 7)}.`;
    if (sourceControl.push) {
      const branch = git.getCurrentBranch(repoRoot);
      await git.pushAsync(repoRoot, branch);
      outputs.push = { remote: 'origin', branch, expectedSha: sha, status: 'completed' };
      summaryText = `Committed ${finalPaths.length} file(s) as ${sha.slice(0, 7)} and pushed to origin/${branch}.`;
    }

    return new ActionExecuteResult({
      actionId: this.id,
      success: true,
      outputs,
      summary: summaryText,
    });
  }
}
