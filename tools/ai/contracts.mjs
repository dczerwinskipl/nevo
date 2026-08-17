import { randomUUID } from 'node:crypto';

export const AGENT_CAPABILITIES = Object.freeze([
  'interactivePermissions',
  'interactiveQuestions',
  'interactiveConfirmations',
  'resumeSession',
  'cancelTurn',
  'toolCalls',
  'reasoning',
  'usage',
]);

export const DEFAULT_AGENT_CAPABILITIES = Object.freeze({
  interactivePermissions: false,
  interactiveQuestions: false,
  interactiveConfirmations: false,
  resumeSession: false,
  cancelTurn: false,
  toolCalls: false,
  reasoning: false,
  usage: false,
});

export const AGENT_EVENT_TYPES = Object.freeze([
  'turn.started',
  'message.started',
  'text.delta',
  'reasoning.delta',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'interaction.requested',
  'interaction.resolved',
  'usage.updated',
  'turn.completed',
  'turn.failed',
]);

export const AI_EVENT_TYPES = AGENT_EVENT_TYPES;

const EVENT_TYPE_SET = new Set(AGENT_EVENT_TYPES);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export class AiError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, { cause });
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export class AiValidationError extends AiError {
  constructor(message, details) {
    super('AI_VALIDATION_ERROR', message, { status: 400, details });
    this.name = 'AiValidationError';
  }
}

export class AiNotFoundError extends AiError {
  constructor(message, details) {
    super('AI_NOT_FOUND', message, { status: 404, details });
    this.name = 'AiNotFoundError';
  }
}

export class CapabilityNotSupportedError extends AiError {
  constructor(provider, capability) {
    super('AI_UNSUPPORTED_OPERATION', `Provider '${provider}' does not support capability '${capability}'.`, {
      status: 409,
      details: { provider, capability },
    });
    this.name = 'CapabilityNotSupportedError';
    this.provider = provider;
    this.capability = capability;
  }
}

export const AiUnsupportedOperationError = CapabilityNotSupportedError;

export class AiTurnConflictError extends AiError {
  constructor(turnId) {
    super('AI_TURN_CONFLICT', 'This session already has a live turn.', {
      status: 409,
      details: { turnId },
    });
    this.name = 'AiTurnConflictError';
    this.turnId = turnId;
  }

  toJSON() {
    return { ...super.toJSON(), turnId: this.turnId };
  }
}

function requiredString(value, field, { opaque = false, max = 512 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new AiValidationError(`'${field}' must be a non-empty string of at most ${max} characters.`, { field });
  }
  if (!opaque && !ID_PATTERN.test(value)) {
    throw new AiValidationError(`'${field}' contains unsupported characters.`, { field });
  }
  return value;
}

function optionalString(value, field, max = 512) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new AiValidationError(`'${field}' must be a string of at most ${max} characters.`, { field });
  }
  return value;
}

export function normalizeTimestamp(value, field) {
  if (typeof value !== 'string') {
    throw new AiValidationError(`'${field}' must be an ISO-8601 timestamp.`, { field });
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new AiValidationError(`'${field}' must be an ISO-8601 timestamp.`, { field });
  }
  return new Date(time).toISOString();
}

export function validateAgentIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('AgentIdentity must be an object.');
  }
  const provider = requiredString(value.provider, 'provider');
  const providerSessionId = requiredString(value.providerSessionId, 'providerSessionId', { opaque: true });
  return { provider, providerSessionId };
}

export function normalizeCapabilities(value, field = 'capabilities') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError(`'${field}' must be an object.`, { field });
  }
  const normalized = {};
  for (const capability of AGENT_CAPABILITIES) {
    normalized[capability] = value[capability] === true;
  }
  return normalized;
}

export const normalizeAgentCapabilities = normalizeCapabilities;

export function validateAiMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Message must be an object.');
  }
  if (!['user', 'assistant', 'system'].includes(value.role)) {
    throw new AiValidationError("'role' must be user, assistant, or system.", { field: 'role' });
  }
  const text = requiredString(value.text, 'text', { opaque: true, max: 100_000 });
  return {
    id: requiredString(value.id, 'id'),
    role: value.role,
    text,
    ...(value.reasoning == null ? {} : { reasoning: optionalString(value.reasoning, 'reasoning', 100_000) }),
    ...(Array.isArray(value.toolCalls) ? { toolCalls: structuredClone(value.toolCalls) } : {}),
    ...(value.interaction ? { interaction: structuredClone(value.interaction) } : {}),
    createdAt: normalizeTimestamp(value.createdAt, 'createdAt'),
  };
}

function rejectProviderFields(value, path = 'event') {
  for (const [key, child] of Object.entries(value || {})) {
    if (/provider.*(?:request|event|payload).*id|providerRequestId|rawPayload/i.test(key)) {
      throw new AiValidationError(`Provider-private field '${key}' is not allowed.`, { field: `${path}.${key}` });
    }
    if (child && typeof child === 'object') rejectProviderFields(child, `${path}.${key}`);
  }
}

export function normalizeInteraction(value, { assignIds = false, idFactory = randomUUID } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Interaction must be an object.');
  }
  rejectProviderFields(value, 'interaction');
  const id = value.id ?? (assignIds ? `interaction-${idFactory()}` : undefined);
  const base = { id: requiredString(id, 'interaction.id'), kind: value.kind };

  switch (value.kind) {
    case 'permission': {
      const input = value.input;
      if (input !== undefined) {
        const encoded = JSON.stringify(input);
        if (!input || typeof input !== 'object' || Array.isArray(input) || encoded.length > 4_096) {
          throw new AiValidationError("Permission 'input' must be a bounded normalized object.", { field: 'interaction.input' });
        }
        rejectProviderFields(input, 'interaction.input');
      }
      return {
        ...base,
        toolName: requiredString(value.toolName, 'interaction.toolName', { opaque: true, max: 100 }),
        ...(input === undefined ? {} : { input: structuredClone(input) }),
        ...(value.details == null ? {} : { details: optionalString(value.details, 'interaction.details', 2_000) }),
      };
    }
    case 'question': {
      if (!Array.isArray(value.questions) || value.questions.length === 0 || value.questions.length > 20) {
        throw new AiValidationError('Question interactions require 1-20 questions.', { field: 'interaction.questions' });
      }
      const questions = value.questions.map((question, index) => {
        const questionId = question?.id ?? (assignIds ? `question-${idFactory()}` : undefined);
        const options = question?.options;
        if (options !== undefined && (!Array.isArray(options) || options.length > 20)) {
          throw new AiValidationError("Question 'options' must be an array of at most 20 items.", { field: `interaction.questions[${index}].options` });
        }
        return {
          id: requiredString(questionId, `interaction.questions[${index}].id`),
          question: requiredString(question?.question, `interaction.questions[${index}].question`, { opaque: true, max: 1_000 }),
          ...(question?.header == null ? {} : { header: optionalString(question.header, `interaction.questions[${index}].header`, 100) }),
          ...(options === undefined ? {} : {
            options: options.map((option, optionIndex) => ({
              label: requiredString(option?.label, `interaction.questions[${index}].options[${optionIndex}].label`, { opaque: true, max: 200 }),
              ...(option?.description == null ? {} : { description: optionalString(option.description, 'option.description', 500) }),
            })),
          }),
          multiSelect: question?.multiSelect === true,
        };
      });
      if (new Set(questions.map(question => question.id)).size !== questions.length) {
        throw new AiValidationError('Question IDs must be unique within an interaction.', { field: 'interaction.questions' });
      }
      return { ...base, questions };
    }
    case 'confirmation': {
      return {
        ...base,
        title: requiredString(value.title ?? 'Confirm Action', 'interaction.title', { opaque: true, max: 200 }),
        message: requiredString(value.message, 'interaction.message', { opaque: true, max: 2_000 }),
        ...(value.details == null ? {} : { details: optionalString(value.details, 'interaction.details', 2_000) }),
        ...(value.payload === undefined ? {} : { payload: structuredClone(value.payload) }),
      };
    }
    default:
      throw new AiValidationError("Interaction 'kind' must be permission, question, or confirmation.", { field: 'interaction.kind' });
  }
}

export function validateInteractionResponse(interaction, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Interaction response must be an object.');
  }
  switch (interaction.kind) {
    case 'permission': {
      if (!['allow', 'deny'].includes(value.decision)) {
        throw new AiValidationError("Permission response 'decision' must be allow or deny.", { field: 'decision' });
      }
      return {
        decision: value.decision,
        ...(value.message == null ? {} : { message: optionalString(value.message, 'message', 1_000) }),
      };
    }
    case 'confirmation': {
      if (typeof value.confirmed !== 'boolean' && !['confirm', 'cancel', 'allow', 'deny'].includes(value.decision)) {
        throw new AiValidationError("Confirmation response must specify 'confirmed' or 'decision'.", { field: 'confirmed' });
      }
      const confirmed = typeof value.confirmed === 'boolean' ? value.confirmed : (value.decision === 'confirm' || value.decision === 'allow');
      return {
        confirmed,
        decision: confirmed ? 'confirm' : 'cancel',
        ...(value.message == null ? {} : { message: optionalString(value.message, 'message', 1_000) }),
      };
    }
    case 'question': {
      if (!Array.isArray(value.answers) || value.answers.length !== interaction.questions.length) {
        throw new AiValidationError('Question responses require one answer per question.', { field: 'answers' });
      }
      const expected = new Set(interaction.questions.map(question => question.id));
      const seen = new Set();
      const answers = value.answers.map((answer, index) => {
        const questionId = requiredString(answer?.questionId, `answers[${index}].questionId`);
        if (!expected.has(questionId) || seen.has(questionId)) {
          throw new AiValidationError('Answers must correlate to each unique question ID.', { field: `answers[${index}].questionId` });
        }
        seen.add(questionId);
        const raw = answer?.value;
        if (typeof raw !== 'string' && !Array.isArray(raw)) {
          throw new AiValidationError("Answer 'value' must be a string or string array.", { field: `answers[${index}].value` });
        }
        const values = Array.isArray(raw) ? raw : [raw];
        if (values.length === 0 || values.some(item => typeof item !== 'string' || item.length > 1_000)) {
          throw new AiValidationError("Answer 'value' is invalid or too large.", { field: `answers[${index}].value` });
        }
        return { questionId, value: Array.isArray(raw) ? [...raw] : raw };
      });
      return { answers };
    }
    default:
      throw new AiValidationError(`Unknown interaction kind '${interaction.kind}'.`, { field: 'interaction.kind' });
  }
}

export function validateAgentEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !EVENT_TYPE_SET.has(value.type)) {
    throw new AiValidationError(`Event type must be one of ${AGENT_EVENT_TYPES.join(', ')}.`, { field: 'type' });
  }
  rejectProviderFields(value);
  const idValue = value.id ?? value.seq;
  const base = {
    id: Number.isSafeInteger(idValue) && idValue > 0 ? idValue : (() => { throw new AiValidationError("Event 'id' must be a positive integer.", { field: 'id' }); })(),
    type: value.type,
    turnId: requiredString(value.turnId, 'turnId'),
    timestamp: normalizeTimestamp(value.timestamp, 'timestamp'),
  };
  if (value.seq !== undefined && Number.isSafeInteger(value.seq)) {
    base.seq = value.seq;
  }

  switch (value.type) {
    case 'message.started':
      return {
        ...base,
        messageId: requiredString(value.messageId, 'messageId'),
        role: ['assistant', 'user', 'system'].includes(value.role) ? value.role : 'assistant',
      };

    case 'text.delta': {
      const text = value.text ?? value.delta;
      return {
        ...base,
        text: requiredString(text, 'text', { opaque: true, max: 50_000 }),
        ...(value.messageId ? { messageId: requiredString(value.messageId, 'messageId') } : {}),
      };
    }

    case 'reasoning.delta':
      return {
        ...base,
        text: requiredString(value.text, 'text', { opaque: true, max: 50_000 }),
        ...(value.messageId ? { messageId: requiredString(value.messageId, 'messageId') } : {}),
      };

    case 'tool.started':
      return {
        ...base,
        toolId: requiredString(value.toolId, 'toolId'),
        toolName: requiredString(value.toolName, 'toolName', { opaque: true, max: 100 }),
        input: value.input === undefined ? {} : structuredClone(value.input),
      };

    case 'tool.updated':
      return {
        ...base,
        toolId: requiredString(value.toolId, 'toolId'),
        ...(value.output !== undefined ? { output: structuredClone(value.output) } : {}),
        ...(value.status ? { status: requiredString(value.status, 'status', { opaque: true, max: 50 }) } : {}),
      };

    case 'tool.completed':
      return {
        ...base,
        toolId: requiredString(value.toolId, 'toolId'),
        ...(value.output !== undefined ? { output: structuredClone(value.output) } : {}),
        ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
      };

    case 'interaction.requested':
      return {
        ...base,
        interaction: normalizeInteraction(value.interaction),
      };

    case 'interaction.resolved':
      return {
        ...base,
        interactionId: requiredString(value.interactionId, 'interactionId'),
        ...(value.response !== undefined ? { response: structuredClone(value.response) } : {}),
      };

    case 'usage.updated':
      return {
        ...base,
        ...(typeof value.tokensIn === 'number' ? { tokensIn: value.tokensIn } : {}),
        ...(typeof value.tokensOut === 'number' ? { tokensOut: value.tokensOut } : {}),
        ...(typeof value.cost === 'number' ? { cost: value.cost } : {}),
      };

    case 'turn.completed':
      return {
        ...base,
        ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
        ...(value.finishReason ? { finishReason: requiredString(value.finishReason, 'finishReason', { opaque: true, max: 50 }) } : {}),
      };

    case 'turn.failed':
      return {
        ...base,
        error: {
          code: requiredString(value.error?.code, 'error.code'),
          message: requiredString(value.error?.message, 'error.message', { opaque: true, max: 2_000 }),
        },
      };

    case 'turn.started':
    default:
      return {
        ...base,
        ...(value.messageId ? { messageId: requiredString(value.messageId, 'messageId') } : {}),
      };
  }
}


export const validateAiEvent = validateAgentEvent;

export function validateProviderDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Provider descriptor must be an object.');
  }
  return {
    id: requiredString(value.id, 'provider.id'),
    label: requiredString(value.label, 'provider.label', { opaque: true, max: 100 }),
    enabled: value.enabled !== false,
    capabilities: normalizeCapabilities(value.capabilities),
  };
}

export function publicAiError(error) {
  if (error instanceof AiError) return error;
  return new AiError('AI_PROVIDER_ERROR', 'The AI provider operation failed.', { status: 502 });
}
