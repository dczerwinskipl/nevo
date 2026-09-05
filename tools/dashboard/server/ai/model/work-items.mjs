import {
  AiValidationError,
  normalizeTimestamp,
  normalizeInteraction,
  INTERACTION_RESUME_POLICIES,
} from '../contracts.mjs';

export const WORK_ITEM_TYPES = Object.freeze(['commentary', 'reasoning', 'tool', 'interaction']);

export const TOOL_KINDS = Object.freeze(['read', 'edit', 'write', 'list', 'search', 'command', 'test', 'web', 'other']);

export const TOOL_STATUSES = Object.freeze([
  'queued',
  'active',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'unknown',
]);

export const TOOL_ACTION_KINDS = Object.freeze([
  'read',
  'write',
  'edit',
  'search',
  'list',
  'execute',
  'fetch',
  'other',
]);

export const TOOL_ACTION_STATUSES = Object.freeze(['active', 'completed', 'failed']);

export const TOOL_CLOSURE_REASONS = Object.freeze([
  'turn_cancelled',
  'turn_failed',
  'turn_interrupted',
  'turn_completed',
  'process_exit',
  'timeout',
  'unknown',
]);

export const REASONING_REPRESENTATIONS = Object.freeze(['summary', 'raw_text', 'provider_defined']);

export const INTERACTION_WORK_STATUSES = Object.freeze([
  'pending',
  'resolved',
  'denied',
  'rejected',
  'cancelled',
  'expired',
]);

export const TERMINAL_WORK_STATUSES = Object.freeze({
  commentary: Object.freeze(['completed']),
  reasoning: Object.freeze(['completed']),
  tool: Object.freeze(['completed', 'failed', 'cancelled', 'interrupted', 'unknown']),
  interaction: Object.freeze(['resolved', 'denied', 'rejected', 'cancelled', 'expired']),
});

export const ACTIVE_WORK_STATUSES = Object.freeze({
  commentary: Object.freeze(['streaming']),
  reasoning: Object.freeze(['streaming']),
  tool: Object.freeze(['queued', 'active']),
  interaction: Object.freeze(['pending']),
});

export function isTerminalWorkStatus(type, status) {
  const terminalList = TERMINAL_WORK_STATUSES[type];
  return terminalList ? terminalList.includes(status) : false;
}

export function isActiveWorkStatus(type, status) {
  const activeList = ACTIVE_WORK_STATUSES[type];
  return activeList ? activeList.includes(status) : false;
}

export function normalizeTransitionalToolStatus(status, fallback = 'active') {
  if (!status || typeof status !== 'string') return fallback;
  const s = status.toLowerCase().trim();
  switch (s) {
    case 'active':
    case 'running':
    case 'in_progress':
    case 'executing':
    case 'streaming':
    case 'busy':
      return 'active';
    case 'queued':
    case 'pending':
      return 'queued';
    case 'completed':
    case 'success':
    case 'done':
    case 'ok':
      return 'completed';
    case 'failed':
    case 'error':
    case 'err':
      return 'failed';
    case 'cancelled':
    case 'canceled':
    case 'aborted':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'unknown':
      return 'unknown';
    default:
      return fallback;
  }
}

function rejectProviderFields(value, path = 'item') {
  for (const [key, child] of Object.entries(value || {})) {
    if (/provider.*(?:request|event|payload).*id|providerRequestId|rawPayload/i.test(key)) {
      throw new AiValidationError(`Provider-private field '${key}' is not allowed in neutral model.`, {
        field: `${path}.${key}`,
      });
    }
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      rejectProviderFields(child, `${path}.${key}`);
    }
  }
}

function requiredString(value, field, { max = 512, opaque = true } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  return value;
}

function optionalString(value, field, max = 2000) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new AiValidationError(`'${field}' must be a string of at most ${max} characters.`, { field });
  }
  return value;
}

function validateSeq(seq, field = 'seq') {
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new AiValidationError(`'${field}' must be a positive integer >= 1.`, { field, value: seq });
  }
  return seq;
}

export function validateToolAction(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError(`ToolAction at index ${index} must be an object.`);
  }
  rejectProviderFields(value, `actions[${index}]`);

  const id = requiredString(value.id, `actions[${index}].id`, { max: 100 });
  const seq = validateSeq(value.seq ?? index + 1, `actions[${index}].seq`);
  const kind = value.kind ?? 'other';
  if (!TOOL_ACTION_KINDS.includes(kind)) {
    throw new AiValidationError(`ToolAction 'kind' must be one of: ${TOOL_ACTION_KINDS.join(', ')}.`, {
      field: `actions[${index}].kind`,
      value: kind,
    });
  }
  const title = requiredString(value.title, `actions[${index}].title`, { max: 200 });
  let status = undefined;
  if (value.status != null) {
    if (!TOOL_ACTION_STATUSES.includes(value.status)) {
      throw new AiValidationError(`ToolAction 'status' must be one of: ${TOOL_ACTION_STATUSES.join(', ')}.`, {
        field: `actions[${index}].status`,
        value: value.status,
      });
    }
    status = value.status;
  }

  return {
    id,
    seq,
    kind,
    title,
    ...(value.description != null
      ? { description: optionalString(value.description, `actions[${index}].description`, 1000) }
      : {}),
    ...(value.target != null ? { target: optionalString(value.target, `actions[${index}].target`, 1000) } : {}),
    ...(status != null ? { status } : {}),
    ...(value.startedAt ? { startedAt: normalizeTimestamp(value.startedAt, `actions[${index}].startedAt`) } : {}),
    ...(value.completedAt
      ? { completedAt: normalizeTimestamp(value.completedAt, `actions[${index}].completedAt`) }
      : {}),
  };
}

export function validateCommentaryWorkItem(value) {
  rejectProviderFields(value, 'commentary');
  const now = new Date().toISOString();

  const id = requiredString(value.id, 'commentary.id');
  const seq = validateSeq(value.seq, 'commentary.seq');
  const text = typeof value.text === 'string' ? value.text : '';
  const status = value.status ?? 'completed';
  if (status !== 'streaming' && status !== 'completed') {
    throw new AiValidationError("Commentary 'status' must be 'streaming' or 'completed'.", {
      field: 'commentary.status',
      value: status,
    });
  }

  return {
    id,
    type: 'commentary',
    seq,
    text,
    status,
    ...(value.confidence ? { confidence: value.confidence } : {}),
    createdAt: normalizeTimestamp(value.createdAt ?? now, 'commentary.createdAt'),
    updatedAt: normalizeTimestamp(value.updatedAt ?? now, 'commentary.updatedAt'),
    ...(value.completedAt ? { completedAt: normalizeTimestamp(value.completedAt, 'commentary.completedAt') } : {}),
  };
}

export function validateReasoningWorkItem(value) {
  rejectProviderFields(value, 'reasoning');
  const now = new Date().toISOString();

  const id = requiredString(value.id, 'reasoning.id');
  const seq = validateSeq(value.seq, 'reasoning.seq');
  const text = typeof value.text === 'string' ? value.text : '';
  const representation = value.representation ?? 'summary';
  if (!REASONING_REPRESENTATIONS.includes(representation)) {
    throw new AiValidationError(`Reasoning 'representation' must be one of: ${REASONING_REPRESENTATIONS.join(', ')}.`, {
      field: 'reasoning.representation',
      value: representation,
    });
  }
  const status = value.status ?? 'completed';
  if (status !== 'streaming' && status !== 'completed') {
    throw new AiValidationError("Reasoning 'status' must be 'streaming' or 'completed'.", {
      field: 'reasoning.status',
      value: status,
    });
  }

  return {
    id,
    type: 'reasoning',
    seq,
    representation,
    text,
    status,
    ...(value.confidence ? { confidence: value.confidence } : {}),
    createdAt: normalizeTimestamp(value.createdAt ?? now, 'reasoning.createdAt'),
    updatedAt: normalizeTimestamp(value.updatedAt ?? now, 'reasoning.updatedAt'),
    ...(value.completedAt ? { completedAt: normalizeTimestamp(value.completedAt, 'reasoning.completedAt') } : {}),
  };
}

export function validateToolInvocationWorkItem(value) {
  rejectProviderFields(value, 'tool');
  const now = new Date().toISOString();

  const id = requiredString(value.id, 'tool.id');
  const seq = validateSeq(value.seq, 'tool.seq');
  const toolName = requiredString(value.toolName, 'tool.toolName', { max: 100 });
  const title = requiredString(value.title ?? toolName, 'tool.title', { max: 200 });
  const kind = value.kind ?? 'other';
  if (!TOOL_KINDS.includes(kind)) {
    throw new AiValidationError(`ToolInvocation 'kind' must be one of: ${TOOL_KINDS.join(', ')}.`, {
      field: 'tool.kind',
      value: kind,
    });
  }

  const status = value.status ?? 'active';
  if (!TOOL_STATUSES.includes(status)) {
    throw new AiValidationError(`ToolInvocation 'status' must be one of: ${TOOL_STATUSES.join(', ')}.`, {
      field: 'tool.status',
      value: status,
    });
  }

  const actions = Array.isArray(value.actions) ? value.actions.map((act, i) => validateToolAction(act, i)) : [];

  let closureReason = undefined;
  if (value.closureReason != null) {
    if (!TOOL_CLOSURE_REASONS.includes(value.closureReason)) {
      throw new AiValidationError(
        `ToolInvocation 'closureReason' must be one of: ${TOOL_CLOSURE_REASONS.join(', ')}.`,
        { field: 'tool.closureReason', value: value.closureReason },
      );
    }
    closureReason = value.closureReason;
  }

  return {
    id,
    type: 'tool',
    seq,
    toolName,
    kind,
    title,
    status,
    actions,
    ...(value.subject != null ? { subject: optionalString(value.subject, 'tool.subject', 200) } : {}),
    ...(value.description != null ? { description: optionalString(value.description, 'tool.description', 1000) } : {}),
    ...(value.input !== undefined ? { input: structuredClone(value.input) } : {}),
    ...(value.output !== undefined ? { output: structuredClone(value.output) } : {}),
    ...(typeof value.exitCode === 'number' ? { exitCode: value.exitCode } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(value.startedAt ? { startedAt: normalizeTimestamp(value.startedAt, 'tool.startedAt') } : {}),
    ...(value.completedAt ? { completedAt: normalizeTimestamp(value.completedAt, 'tool.completedAt') } : {}),
    ...(closureReason ? { closureReason } : {}),
    ...(value.progress != null ? { progress: optionalString(value.progress, 'tool.progress', 200) } : {}),
    ...(value.confidence ? { confidence: value.confidence } : {}),
    createdAt: normalizeTimestamp(value.createdAt ?? now, 'tool.createdAt'),
    updatedAt: normalizeTimestamp(value.updatedAt ?? now, 'tool.updatedAt'),
  };
}

export function validateInteractionWorkItem(value) {
  rejectProviderFields(value, 'interaction');
  const now = new Date().toISOString();

  const id = requiredString(value.id, 'interaction.id');
  const seq = validateSeq(value.seq, 'interaction.seq');
  const interaction = normalizeInteraction(value.interaction);
  const status = value.status ?? 'pending';
  if (!INTERACTION_WORK_STATUSES.includes(status)) {
    throw new AiValidationError(
      `InteractionWorkItem 'status' must be one of: ${INTERACTION_WORK_STATUSES.join(', ')}.`,
      { field: 'interaction.status', value: status },
    );
  }

  return {
    id,
    type: 'interaction',
    seq,
    interaction,
    status,
    ...(value.response !== undefined ? { response: structuredClone(value.response) } : {}),
    ...(value.resolvedAt ? { resolvedAt: normalizeTimestamp(value.resolvedAt, 'interaction.resolvedAt') } : {}),
    createdAt: normalizeTimestamp(value.createdAt ?? now, 'interaction.createdAt'),
    updatedAt: normalizeTimestamp(value.updatedAt ?? now, 'interaction.updatedAt'),
  };
}

export function validateWorkItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('WorkItem must be an object.');
  }

  switch (value.type) {
    case 'commentary':
      return validateCommentaryWorkItem(value);
    case 'reasoning':
      return validateReasoningWorkItem(value);
    case 'tool':
      return validateToolInvocationWorkItem(value);
    case 'interaction':
      return validateInteractionWorkItem(value);
    default:
      throw new AiValidationError(`WorkItem 'type' must be one of: ${WORK_ITEM_TYPES.join(', ')}.`, {
        field: 'type',
        value: value.type,
      });
  }
}
