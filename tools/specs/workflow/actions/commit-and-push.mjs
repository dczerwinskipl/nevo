// Fail-closed source-control commit/push action (D12, D15) — the reference ActionContract
// implementation for this workflow subsystem. Local Git facts/mutations only; a
// remote-provider-specific mutation (e.g. opening a PR) is out of scope for this action —
// `sourceControl.remote` only identifies which provider *would* be used for a future
// provider-specific capability (D12).

import { relative, join } from 'node:path';
import { statSync, readdirSync } from 'node:fs';
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
  required: false,
  description: "Explicit file selection array (defaults to ['*'])",
};

const EXCLUDE_SCHEMA = {
  name: 'exclude',
  type: 'array',
  required: false,
  description: 'File paths or globs to exclude from staging',
};

export function resolveWorkflowOwnedPaths(context = {}) {
  const explicit = Array.isArray(context.workflowOwnedPaths) ? context.workflowOwnedPaths : [];
  const changeSlug = context.changeSlug || context.changeId;
  const derived = [];
  if (changeSlug) {
    if (context.activeDir && context.repoRoot) {
      const relChangeYaml = relative(context.repoRoot, join(context.activeDir, changeSlug, 'change.yaml')).replace(/\\/g, '/');
      const relReviews = relative(context.repoRoot, join(context.activeDir, changeSlug, 'reviews/**')).replace(/\\/g, '/');
      if (!relChangeYaml.startsWith('..')) {
        derived.push(relChangeYaml);
      } else {
        derived.push(`specs/active/${changeSlug}/change.yaml`);
      }
      if (!relReviews.startsWith('..')) {
        derived.push(relReviews);
      } else {
        derived.push(`specs/active/${changeSlug}/reviews/**`);
      }
    } else {
      derived.push(`specs/active/${changeSlug}/change.yaml`);
      derived.push(`specs/active/${changeSlug}/reviews/**`);
    }
  }
  return [...new Set([...explicit, ...derived])];
}


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

function expandDirtyPaths(repoRoot, paths) {
  const result = [];
  for (const p of paths) {
    const full = join(repoRoot, p);
    try {
      if (statSync(full).isDirectory()) {
        const readdirRecursive = (dir, rel) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              readdirRecursive(join(dir, entry.name), entryRel);
            } else {
              result.push(entryRel.replace(/\\/g, '/'));
            }
          }
        };
        readdirRecursive(full, p.replace(/\/+$/, ''));
        continue;
      }
    } catch {
      // ignore
    }
    result.push(p.replace(/\\/g, '/'));
  }
  return result;
}


/**
 * Fail-closed source-control commit/push action. `check(context)` never mutates
 * anything; `execute(inputs, context)` (via `executeValidated`, the `ActionContract`
 * boundary) stages the caller's explicit `include`/`exclude` file selection (defaulting
 * to `['*']`), commits, and pushes only when `sourceControl.push` is enabled.
 * If the working tree is clean, it records a clean noop commit without error.
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
    return 'Fail-closed source-control commit and push action with clean noop commit and default whole-attempt staging.';
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
    const rawDirtyPaths = git.getDirtyPaths(repoRoot).filter(p => !p.startsWith('.nevo-ai-local/') && p !== '.nevo-ai-local');
    const dirtyPaths = expandDirtyPaths(repoRoot, rawDirtyPaths);
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

    const isDirty = dirtyPaths.length > 0;
    const titleSchema = COMMIT_TITLE_SCHEMA;
    const includeSchema = { ...INCLUDE_SCHEMA, required: false };

    return new ActionCheckResult({
      actionId: this.id,
      requiredInputs: [titleSchema, COMMIT_MESSAGE_SCHEMA, includeSchema, EXCLUDE_SCHEMA],
      context: factualContext,
      ready: true,
      summary: isDirty ? 'Ready to commit changes.' : 'Working tree clean; ready for clean noop commit.',
    });
  }

  async executeValidated(inputs, context = {}) {
    const repoRoot = context.repoRoot;
    if (!repoRoot || typeof repoRoot !== 'string') {
      throw new WorkflowError(`Action '${this.id}' executeValidated(inputs, context) requires context.repoRoot`);
    }

    const rawDirtyPaths = git.getDirtyPaths(repoRoot).filter(p => !p.startsWith('.nevo-ai-local/') && p !== '.nevo-ai-local');
    const dirtyPaths = expandDirtyPaths(repoRoot, rawDirtyPaths);

    if (dirtyPaths.length === 0) {
      const sha = git.getCurrentRevision(repoRoot);
      const outputs = { commit: { sha, status: 'noop' } };
      let summaryText = `Working tree clean; recorded noop commit at ${sha.slice(0, 7)}.`;
      const sourceControl = normalizeSourceControlConfig(context.sourceControl);
      if (sourceControl.push) {
        const branch = git.getCurrentBranch(repoRoot);
        outputs.push = { remote: 'origin', branch, expectedSha: sha, status: 'noop' };
      }
      return new ActionExecuteResult({
        actionId: this.id,
        success: true,
        outputs,
        summary: summaryText,
      });
    }

    const taskAllowedPaths = Array.isArray(context.taskAllowedPaths)
      ? context.taskAllowedPaths
      : (Array.isArray(context.allowedPaths) ? context.allowedPaths : null);
    const workflowOwnedPaths = resolveWorkflowOwnedPaths(context);

    const hasScopeConstraint = Array.isArray(taskAllowedPaths) && taskAllowedPaths.length > 0;

    if (hasScopeConstraint) {
      const allowedPatterns = [
        ...taskAllowedPaths,
        ...workflowOwnedPaths,
      ];
      const outOfScopePaths = dirtyPaths.filter(p => !allowedPatterns.some(pattern => matchesFileSelectionPattern(p, pattern)));
      if (outOfScopePaths.length > 0) {
        throw new WorkflowError(
          `Working tree contains changes outside allowed scope (${outOfScopePaths.join(', ')}): ${outOfScopePaths.join(', ')}`,
          {
            code: 'OUT_OF_SCOPE_WORKTREE_CHANGES',
            outOfScopePaths,
            allowedPaths: allowedPatterns,
          }
        );
      }
    }

    const title = typeof inputs['commit.title'] === 'string' ? inputs['commit.title'].trim() : '';
    if (!title) {
      throw new PreconditionError(
        `Action '${this.id}' requires non-empty commit.title`,
        [{ field: 'commit.title', message: 'commit.title must be a non-empty string', code: 'REQUIRED_FIELD_MISSING' }],
        this.id
      );
    }

    const isDefaultInclude = inputs.include === undefined;
    const includePatterns = isDefaultInclude ? ['*'] : inputs.include;

    if (!Array.isArray(includePatterns) || includePatterns.length === 0) {
      throw new PreconditionError(
        `Action '${this.id}' requires include to be a non-empty array when specified`,
        [{ field: 'include', message: 'include must be a non-empty array of explicit paths/globs', code: 'REQUIRED_FIELD_MISSING' }],
        this.id
      );
    }

    const included = resolveFileSelection(dirtyPaths, includePatterns);
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

    if (isDefaultInclude || context.verifyCleanTree) {
      const remainingRaw = git.getDirtyPaths(repoRoot).filter(p => !p.startsWith('.nevo-ai-local/') && p !== '.nevo-ai-local');
      const remainingDirty = expandDirtyPaths(repoRoot, remainingRaw);
      if (remainingDirty.length > 0) {
        throw new WorkflowError(
          `Working tree is not clean after commit: ${remainingDirty.join(', ')}`,
          { code: 'DIRTY_WORKTREE_AFTER_COMMIT', dirtyPaths: remainingDirty }
        );
      }
    }

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
