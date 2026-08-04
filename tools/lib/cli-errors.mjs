// Error type for expected, user-facing CLI failures (invalid usage, invalid YAML,
// invalid workflow transitions, missing files, path-safety violations, ...).
// The top-level CLI boundary in tools/specs.mjs and tools/docs.mjs prints
// CliError messages without a stack trace; anything else is a programmer error
// and is allowed to surface with its full stack so it stays diagnosable.

export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

// ── Canonical recovery scenario set (REC-01..REC-09) ────────────────────────
//
// Owned by area `recovery-and-resume` (see overview.md § "Recovery model").
// `class` is one of `automatic` (fixes itself same-turn, no suspension needed) /
// `confirm-required` (one closed-choice confirmation clears it) / `owner-decision`
// (the owner must decide, not the controller) / `unsafe-manual` (no automated or
// confirmed path exists at all — the controller stops and waits).
// `previousAction` is the retry target `execution.suspension.previous_action`
// records when this scenario is persisted as a suspension.
export const RECOVERY_SCENARIOS = {
  'REC-01': {
    code: 'REC-01',
    name: 'WRONG_BRANCH',
    class: 'automatic',
    confirmationRequired: false,
    description: 'The current branch is not the task/change branch the action expects.',
    proposedRecovery: 'Check out the expected branch, creating it only if it exists nowhere.',
    previousAction: 'start',
  },
  'REC-02': {
    code: 'REC-02',
    name: 'REMOTE_BRANCH_ONLY',
    class: 'automatic',
    confirmationRequired: false,
    description: 'The task/change branch exists on origin but has no local ref.',
    proposedRecovery: 'Fetch and check out the existing remote branch instead of creating a diverging local one.',
    previousAction: 'start',
  },
  'REC-03': {
    code: 'REC-03',
    name: 'STALE_GENERATED_FILE',
    class: 'automatic',
    confirmationRequired: false,
    description: 'A generated index (specs/*.generated.* or docs/index.generated.*) is stale relative to its source.',
    proposedRecovery: 'Regenerate the index (node tools/specs.mjs generate / node tools/docs.mjs generate).',
    previousAction: 'generate',
  },
  'REC-04': {
    code: 'REC-04',
    name: 'MECHANICAL_VALIDATION_FAILURE',
    class: 'confirm-required',
    confirmationRequired: true,
    description: 'A validate error has a single, unambiguous mechanical fix (e.g. a resolvable but missing semantic_references entry).',
    proposedRecovery: 'Apply the unambiguous fix, then re-run validate.',
    previousAction: 'validate',
  },
  'REC-05': {
    code: 'REC-05',
    name: 'DIRTY_WORKTREE_TASK_FILES',
    class: 'confirm-required',
    confirmationRequired: true,
    description: "The working tree is dirty, but every changed file is within the task's own allowed_paths.",
    proposedRecovery: 'Commit the task-related changes, then retry.',
    previousAction: 'start',
  },
  'REC-06': {
    code: 'REC-06',
    name: 'DIRTY_WORKTREE_UNRELATED_FILES',
    class: 'owner-decision',
    confirmationRequired: true,
    description: "The working tree is dirty and at least one changed file is outside the task's allowed_paths.",
    proposedRecovery: 'Owner decides how to handle the unrelated files (commit/stash/discard) — the controller never touches out-of-scope files itself.',
    previousAction: 'start',
  },
  'REC-07': {
    code: 'REC-07',
    name: 'STALE_REVIEW_AFTER_SEMANTIC_CHANGE',
    class: 'confirm-required',
    confirmationRequired: true,
    description: "A review's recorded fingerprint no longer matches the current specification state.",
    proposedRecovery: 'Re-run the review, then retry approval.',
    previousAction: 'approve',
  },
  'REC-08': {
    code: 'REC-08',
    name: 'SCOPE_EXPANSION',
    class: 'owner-decision',
    confirmationRequired: true,
    description: "Implementation needs to touch paths outside the task's approved allowed_paths.",
    proposedRecovery: "Owner decides: expand the task's allowed_paths, split the extra work into a new task, or scope the implementation back down.",
    previousAction: null,
  },
  'REC-09': {
    code: 'REC-09',
    name: 'ADR_CONFLICT',
    class: 'unsafe-manual',
    confirmationRequired: false,
    description: 'The change conflicts with an accepted architectural decision record.',
    proposedRecovery: 'No automated or confirmed path — the owner resolves the conflict manually (supersede the ADR, or change the approach).',
    previousAction: null,
  },
};

/**
 * A CliError carrying a classified recovery scenario — machine-readable, not just
 * a human sentence. `suspension` (when present) is the exact `execution.suspension`
 * payload the caller persisted for this stop; `null` for an `automatic`-class
 * scenario, which fixes itself same-turn and is never persisted (requirement 6).
 */
export class RecoveryError extends CliError {
  constructor(scenarioCode, { detail, previousAction, suspension = null } = {}) {
    const scenario = RECOVERY_SCENARIOS[scenarioCode];
    if (!scenario) throw new Error(`Unknown recovery scenario '${scenarioCode}'`);
    super(detail ? `${scenario.code} ${scenario.name}: ${detail}` : `${scenario.code} ${scenario.name}: ${scenario.description}`);
    this.name = 'RecoveryError';
    this.code = scenario.code;
    this.scenario = scenario;
    const retryCommand = previousAction ?? scenario.previousAction;
    // `recovery` is the machine-readable shape a caller (or a future
    // conversational layer) programs against: what kind of stop this is, what
    // to do about it, and what to retry once it's resolved.
    this.recovery = { class: scenario.class, suggestedFix: scenario.proposedRecovery, retryCommand };
    this.previousAction = retryCommand;
    this.suspension = suspension;
  }

  get class() {
    return this.recovery.class;
  }
}
