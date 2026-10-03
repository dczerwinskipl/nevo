export const SPEC_STAGES = Object.freeze([
  { id: 'new', label: 'Nowe', shortLabel: 'Nowe' },
  { id: 'design', label: 'Projektowanie', shortLabel: 'Projekt' },
  { id: 'ready', label: 'Ready', shortLabel: 'Ready' },
  { id: 'implementation', label: 'Implementacja', shortLabel: 'Implementacja' },
  { id: 'review', label: 'Review', shortLabel: 'Review' },
  { id: 'done', label: 'Gotowe', shortLabel: 'Gotowe' },
]);

const STATUS_TO_STAGE = Object.freeze({
  new: 'new',
  draft: 'design',
  approved: 'ready',
  'in-implementation': 'implementation',
  implemented: 'review',
  verified: 'done',
  archived: 'done',
  abandoned: 'done',
});

const COMPLETED_STATUSES = new Set(['verified', 'archived']);
const TERMINAL_STATUSES = new Set(['verified', 'archived', 'abandoned']);
const DEPENDENCY_READY_STATUSES = new Set(['implemented', 'verified', 'archived']);

export function stageForStatus(status) {
  return STATUS_TO_STAGE[status] ?? 'new';
}

export function isCompletedStatus(status) {
  return COMPLETED_STATUSES.has(status);
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function isDependencyReadyStatus(status) {
  return DEPENDENCY_READY_STATUSES.has(status);
}

/**
 * Maps canonical TaskProjection state (and optional executor) onto the dashboard's
 * 6-lane set ('new', 'design', 'ready', 'implementation', 'review', 'done').
 *
 * NOTE: The reuse of legacy lane IDs ('implementation', 'review', etc.) is purely
 * a presentation and compatibility convenience for the dashboard board.
 * It carries NO workflow-step semantics. Lane derivation MUST NEVER receive or branch
 * on step IDs (currentStep/nextStep).
 *
 * @param {string|object} state - TaskProjection state ('draft', 'blocked', 'ready', 'active', 'waiting-for-step-start', 'human-interaction', 'terminal') or projection object
 * @param {string|null} [executor] - Optional executor ('agent', 'human')
 * @returns {string} One of SPEC_STAGES IDs ('design', 'ready', 'implementation', 'review', 'done')
 */
export function stageForDeterministicState(state, executor = null) {
  let targetState = state;
  let targetExecutor = executor;
  if (typeof state === 'object' && state !== null) {
    targetState = state.state;
    targetExecutor = state.executor ?? executor;
  }
  switch (targetState) {
    case 'draft':
      return 'design';
    case 'blocked':
    case 'ready':
      return 'ready';
    case 'active':
      return 'implementation';
    case 'human-interaction':
      return 'review';
    case 'waiting-for-step-start':
      return targetExecutor === 'human' ? 'review' : 'implementation';
    case 'terminal':
      return 'done';
    default:
      return 'new';
  }
}

export const stageForDeterministicTask = stageForDeterministicState;
