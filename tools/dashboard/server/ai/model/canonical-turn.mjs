import {
  AiValidationError,
  normalizeTimestamp,
  validateAgentExecutionMode,
  DEFAULT_AGENT_EXECUTION_MODE,
} from '../contracts.mjs';
import { validateTurnStatus, createTurnStatus } from './turn-status.mjs';
import { validateWorkItem, validateToolAction, isTerminalWorkStatus, isActiveWorkStatus } from './work-items.mjs';
import { validateFinalAnswer, createFinalAnswer } from './final-answer.mjs';

function requiredString(value, field, max = 256) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  return value.trim();
}

function rejectProviderFields(value, path = 'turn') {
  for (const [key, child] of Object.entries(value || {})) {
    if (/provider.*(?:request|event|payload).*id|providerRequestId|rawPayload/i.test(key)) {
      throw new AiValidationError(`Provider-private field '${key}' is not allowed in canonical turn.`, { field: `${path}.${key}` });
    }
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      rejectProviderFields(child, `${path}.${key}`);
    }
  }
}

export function validateCanonicalTurn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('CanonicalTurn must be an object.');
  }
  rejectProviderFields(value);

  const id = requiredString(value.id ?? value.turnId, 'turn.id');
  const sessionId = requiredString(value.sessionId, 'turn.sessionId');
  const provider = requiredString(value.provider, 'turn.provider');
  const providerSessionId = value.providerSessionId != null && value.providerSessionId !== ''
    ? requiredString(value.providerSessionId, 'turn.providerSessionId')
    : null;
  const mode = validateAgentExecutionMode(value.mode ?? DEFAULT_AGENT_EXECUTION_MODE, 'turn.mode');

  const status = validateTurnStatus(value.status);
  const now = new Date().toISOString();
  const createdAt = normalizeTimestamp(value.createdAt ?? now, 'turn.createdAt');
  const updatedAt = normalizeTimestamp(value.updatedAt ?? now, 'turn.updatedAt');

  const work = Array.isArray(value.work)
    ? value.work.map((item, idx) => {
      const validated = validateWorkItem(item);
      if (validated.seq !== idx + 1) {
        throw new AiValidationError(
          `Work item at index ${idx} has seq ${validated.seq}, expected ${idx + 1}.`,
          { field: `work[${idx}].seq` },
        );
      }
      return validated;
    })
    : [];

  const activityCount = work.length;

  const finalAnswer = value.finalAnswer != null ? validateFinalAnswer(value.finalAnswer) : null;

  let terminalOutcome = undefined;
  if (value.terminalOutcome) {
    terminalOutcome = {
      outcome: requiredString(value.terminalOutcome.outcome, 'terminalOutcome.outcome', 50),
      initiator: requiredString(value.terminalOutcome.initiator ?? 'provider', 'terminalOutcome.initiator', 50),
      ...(value.terminalOutcome.cause ? { cause: requiredString(value.terminalOutcome.cause, 'terminalOutcome.cause', 200) } : {}),
      ...(value.terminalOutcome.finishReason ? { finishReason: requiredString(value.terminalOutcome.finishReason, 'terminalOutcome.finishReason', 100) } : {}),
      ...(value.terminalOutcome.error ? {
        error: {
          code: requiredString(value.terminalOutcome.error.code, 'terminalOutcome.error.code', 100),
          message: requiredString(value.terminalOutcome.error.message, 'terminalOutcome.error.message', 2000),
        },
      } : {}),
      completedAt: normalizeTimestamp(value.terminalOutcome.completedAt ?? now, 'terminalOutcome.completedAt'),
    };
  }

  // Cross-field invariant checks
  if (status.status === 'requiresAttention') {
    const matchingInteraction = work.find(
      w => w.type === 'interaction' && w.id === status.interactionId && w.status === 'pending',
    );
    if (!matchingInteraction) {
      throw new AiValidationError(
        `Turn status is requiresAttention with interactionId '${status.interactionId}', but no matching pending interaction exists in Work items.`,
        { field: 'status.interactionId' },
      );
    }
  }

  return {
    id,
    turnId: id,
    sessionId,
    provider,
    providerSessionId,
    mode,
    status,
    work,
    activityCount,
    finalAnswer,
    ...(terminalOutcome ? { terminalOutcome } : {}),
    ...(value.usage ? {
      usage: {
        ...(typeof value.usage.tokensIn === 'number' ? { tokensIn: value.usage.tokensIn } : {}),
        ...(typeof value.usage.tokensOut === 'number' ? { tokensOut: value.usage.tokensOut } : {}),
        ...(typeof value.usage.cost === 'number' ? { cost: value.usage.cost } : {}),
      },
    } : {}),
    createdAt,
    updatedAt,
    ...(value.completedAt ? { completedAt: normalizeTimestamp(value.completedAt, 'turn.completedAt') } : {}),
  };
}

export function createCanonicalTurn({
  id,
  turnId,
  sessionId,
  provider,
  providerSessionId,
  mode = DEFAULT_AGENT_EXECUTION_MODE,
  status = createTurnStatus('active', { detail: 'startup' }),
  createdAt = new Date().toISOString(),
}) {
  return validateCanonicalTurn({
    id: id ?? turnId,
    turnId: id ?? turnId,
    sessionId,
    provider,
    providerSessionId,
    mode,
    status: typeof status === 'string' ? createTurnStatus(status) : status,
    work: [],
    activityCount: 0,
    finalAnswer: null,
    createdAt,
    updatedAt: createdAt,
  });
}

export function appendWorkItem(turn, rawItem) {
  if (turn.status.status === 'terminal') {
    throw new AiValidationError('Cannot append Work items to a terminal Turn.');
  }

  const nextSeq = turn.work.length + 1;
  const itemToValidate = {
    ...rawItem,
    seq: nextSeq,
    createdAt: rawItem.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validated = validateWorkItem(itemToValidate);
  turn.work.push(validated);
  turn.activityCount = turn.work.length;
  turn.updatedAt = new Date().toISOString();
  return validated;
}

export function updateWorkItem(turn, itemId, updates) {
  const index = turn.work.findIndex(item => item.id === itemId);
  if (index === -1) {
    throw new AiValidationError(`WorkItem '${itemId}' not found in turn '${turn.id}'.`);
  }

  const current = turn.work[index];

  // Invariant C1 & C3: type and sequence can NEVER change
  if (updates.type !== undefined && updates.type !== current.type) {
    throw new AiValidationError(`WorkItem type cannot be changed from '${current.type}' to '${updates.type}'.`);
  }
  if (updates.seq !== undefined && updates.seq !== current.seq) {
    throw new AiValidationError(`WorkItem sequence cannot be changed from '${current.seq}' to '${updates.seq}'.`);
  }

  // Invariant: Terminal items cannot return to active/pending
  const isCurrentlyTerminal = isTerminalWorkStatus(current.type, current.status);
  const targetStatus = updates.status ?? current.status;
  if (isCurrentlyTerminal && isActiveWorkStatus(current.type, targetStatus)) {
    throw new AiValidationError(`Terminal ${current.type} WorkItem '${itemId}' (status: ${current.status}) cannot return to active status '${targetStatus}'.`);
  }

  const merged = {
    ...current,
    ...updates,
    id: current.id,
    type: current.type,
    seq: current.seq,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const validated = validateWorkItem(merged);
  turn.work[index] = validated;
  turn.updatedAt = new Date().toISOString();
  return validated;
}

export function addToolAction(toolItem, rawAction) {
  if (toolItem.type !== 'tool') {
    throw new AiValidationError("ToolAction can only be added to a 'tool' WorkItem.");
  }
  if (!Array.isArray(toolItem.actions)) {
    toolItem.actions = [];
  }

  const nextSeq = toolItem.actions.length + 1;
  const actionToValidate = {
    ...rawAction,
    seq: rawAction.seq ?? nextSeq,
    startedAt: rawAction.startedAt ?? new Date().toISOString(),
  };

  const validated = validateToolAction(actionToValidate, toolItem.actions.length);
  toolItem.actions.push(validated);
  toolItem.updatedAt = new Date().toISOString();
  return validated;
}

export function setFinalAnswer(turn, finalAnswerData) {
  if (!finalAnswerData) {
    turn.finalAnswer = null;
    turn.updatedAt = new Date().toISOString();
    return null;
  }

  const validated = validateFinalAnswer(finalAnswerData);
  turn.finalAnswer = validated;
  turn.updatedAt = new Date().toISOString();
  return validated;
}

export function setTurnStatus(turn, newStatus) {
  const currentStatus = turn.status?.status;
  const targetStatusObj = typeof newStatus === 'string' ? createTurnStatus(newStatus) : validateTurnStatus(newStatus);
  const targetStatus = targetStatusObj.status;

  if (currentStatus === 'terminal' && targetStatus !== 'terminal') {
    throw new AiValidationError(`Terminal Turn '${turn.id}' cannot transition back to status '${targetStatus}'.`);
  }

  // If entering requiresAttention, check that a pending interaction exists
  if (targetStatus === 'requiresAttention') {
    const pendingInt = turn.work.find(
      w => w.type === 'interaction' && w.id === targetStatusObj.interactionId && w.status === 'pending',
    );
    if (!pendingInt) {
      throw new AiValidationError(
        `Cannot transition to requiresAttention: no matching pending interaction '${targetStatusObj.interactionId}' found.`,
      );
    }
  }

  turn.status = targetStatusObj;
  turn.updatedAt = new Date().toISOString();

  if (targetStatus === 'terminal') {
    turn.completedAt = targetStatusObj.since;
    turn.terminalOutcome = {
      outcome: targetStatusObj.outcome,
      initiator: targetStatusObj.initiator,
      ...(targetStatusObj.cause ? { cause: targetStatusObj.cause } : {}),
      ...(targetStatusObj.finishReason ? { finishReason: targetStatusObj.finishReason } : {}),
      ...(targetStatusObj.error ? { error: structuredClone(targetStatusObj.error) } : {}),
      completedAt: targetStatusObj.since,
    };
  }

  return turn.status;
}

export function computeCurrentActivity(turn) {
  if (!turn) return { kind: 'unknown', title: 'No active session', status: 'unknown' };

  const status = turn.status?.status;

  if (status === 'requiresAttention') {
    const interaction = turn.work.find(w => w.type === 'interaction' && w.id === turn.status.interactionId);
    return {
      kind: 'attention',
      title: interaction?.interaction?.kind === 'permission'
        ? `Permission required for ${interaction.interaction.toolName || 'tool'}`
        : (interaction?.interaction?.kind === 'question' ? 'User input question pending' : 'Confirmation required'),
      status: 'requiresAttention',
      subjectId: turn.status.interactionId,
    };
  }

  if (status === 'active') {
    // Look for currently active tool invocation
    const activeTool = [...turn.work].reverse().find(w => w.type === 'tool' && w.status === 'active');
    if (activeTool) {
      return {
        kind: activeTool.kind,
        title: activeTool.title,
        status: 'active',
        subjectId: activeTool.id,
      };
    }

    const detail = turn.status.detail || 'processing';
    const detailTitles = {
      startup: 'Initializing session',
      processing: 'Model is thinking',
      commentary: 'Generating response',
      reasoning: 'Reasoning',
      tool_execution: 'Running tool',
    };
    return {
      kind: detail,
      title: detailTitles[detail] ?? 'Processing',
      status: 'active',
    };
  }

  if (status === 'waiting') {
    const isTool = turn.status.reason === 'tool_result';
    return {
      kind: 'waiting',
      title: isTool ? 'Waiting for tool execution' : 'Waiting for model response',
      status: 'waiting',
      subjectId: turn.status.subjectId,
    };
  }

  if (status === 'cancelling') {
    return {
      kind: 'cancelling',
      title: 'Cancelling turn...',
      status: 'cancelling',
    };
  }

  if (status === 'terminal') {
    const latest = [...turn.work].reverse().find(w => w.type === 'tool' || w.type === 'commentary');
    return {
      kind: latest?.kind ?? 'terminal',
      title: latest ? (latest.title ?? latest.type) : `Turn ${turn.status.outcome}`,
      status: turn.status.outcome,
      subjectId: latest?.id,
    };
  }

  return {
    kind: 'unknown',
    title: 'Unknown state',
    status: 'unknown',
  };
}

export function bindTurnProviderSessionId(turn, allocatedId) {
  if (!allocatedId || typeof allocatedId !== 'string' || allocatedId.trim().length === 0) {
    throw new AiValidationError("Property 'providerSessionId' must be a non-empty string.", { field: 'providerSessionId' });
  }
  const validId = allocatedId.trim();
  if (turn.providerSessionId && turn.providerSessionId !== validId) {
    throw new AiValidationError(
      `Cannot re-bind turn '${turn.id}' providerSessionId from '${turn.providerSessionId}' to '${validId}'.`,
      { field: 'providerSessionId' },
    );
  }
  turn.providerSessionId = validId;
  turn.updatedAt = new Date().toISOString();
  return validId;
}
