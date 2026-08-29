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
