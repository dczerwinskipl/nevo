import { randomUUID } from 'node:crypto';

export const AI_SESSION_STATUSES = Object.freeze([
  'running',
  'waitingForUser',
  'idle',
  'completed',
]);

export const AI_CAPABILITIES = Object.freeze([
  'listSessions',
  'sessionMetadata',
  'messages',
  'createSession',
  'startTurn',
  'streamEvents',
  'resumeTurn',
  'resolveInteractions',
  'cancelTurn',
]);

export const AI_EVENT_TYPES = Object.freeze([
  'turn.started',
  'message.delta',
  'interaction.requested',
  'interaction.resolved',
  'turn.completed',
  'turn.failed',
  'activity',
]);

const SESSION_STATUS_SET = new Set(AI_SESSION_STATUSES);
const EVENT_TYPE_SET = new Set(AI_EVENT_TYPES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

export class AiUnsupportedOperationError extends AiError {
  constructor(provider, capability) {
    super('AI_UNSUPPORTED_OPERATION', `Provider '${provider}' does not support '${capability}'.`, {
      status: 409,
      details: { provider, capability },
    });
    this.name = 'AiUnsupportedOperationError';
  }
}

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

function normalizeCapabilities(value, field = 'capabilities') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError(`'${field}' must be an object.`, { field });
  }
  return Object.fromEntries(AI_CAPABILITIES.map(capability => [capability, value[capability] === true]));
}

export function validateAiSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Session must be an object.');
  }
  const specId = requiredString(value.specId, 'specId');
  if (!UUID_PATTERN.test(specId)) {
    throw new AiValidationError("'specId' must be a UUID.", { field: 'specId' });
  }
  const provider = requiredString(value.provider, 'provider');
  const sessionId = requiredString(value.sessionId, 'sessionId', { opaque: true });
  if (!Array.isArray(value.taskIds) || value.taskIds.some(taskId => typeof taskId !== 'string' || !ID_PATTERN.test(taskId))) {
    throw new AiValidationError("'taskIds' must be an array of stable task IDs.", { field: 'taskIds' });
  }
  if (!SESSION_STATUS_SET.has(value.status)) {
    throw new AiValidationError(`'status' must be one of ${AI_SESSION_STATUSES.join(', ')}.`, { field: 'status' });
  }
  const createdAt = normalizeTimestamp(value.createdAt, 'createdAt');
  const lastActivityAt = normalizeTimestamp(value.lastActivityAt, 'lastActivityAt');
  const completedAt = value.completedAt == null ? undefined : normalizeTimestamp(value.completedAt, 'completedAt');
  if (Date.parse(lastActivityAt) < Date.parse(createdAt)) {
    throw new AiValidationError("'lastActivityAt' cannot be before 'createdAt'.", { field: 'lastActivityAt' });
  }
  if (value.status === 'completed' && !completedAt) {
    throw new AiValidationError("Completed sessions require 'completedAt'.", { field: 'completedAt' });
  }
  return {
    specId,
    provider,
    sessionId,
    taskIds: [...new Set(value.taskIds)],
    ...(value.title == null ? {} : { title: optionalString(value.title, 'title', 200) }),
    status: value.status,
    createdAt,
    lastActivityAt,
    ...(completedAt ? { completedAt } : {}),
    capabilities: normalizeCapabilities(value.capabilities),
  };
}

export function compareAiSessionsByActivity(left, right) {
  const activity = Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
  if (activity !== 0) return activity;
  const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (created !== 0) return created;
  const provider = left.provider.localeCompare(right.provider);
  return provider || left.sessionId.localeCompare(right.sessionId);
}

export function sortAiSessions(sessions) {
  return sessions.map(validateAiSession).sort(compareAiSessionsByActivity);
}

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
  if (value.kind === 'permission') {
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
  if (value.kind === 'question') {
    if (!Array.isArray(value.questions) || value.questions.length === 0 || value.questions.length > 20) {
      throw new AiValidationError("Question interactions require 1-20 questions.", { field: 'interaction.questions' });
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
  throw new AiValidationError("Interaction 'kind' must be permission or question.", { field: 'interaction.kind' });
}

export function validateInteractionResponse(interaction, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiValidationError('Interaction response must be an object.');
  }
  if (interaction.kind === 'permission') {
    if (!['allow', 'deny'].includes(value.decision)) {
      throw new AiValidationError("Permission response 'decision' must be allow or deny.", { field: 'decision' });
    }
    return {
      decision: value.decision,
      ...(value.message == null ? {} : { message: optionalString(value.message, 'message', 1_000) }),
    };
  }
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

export function validateAiEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !EVENT_TYPE_SET.has(value.type)) {
    throw new AiValidationError(`Event type must be one of ${AI_EVENT_TYPES.join(', ')}.`, { field: 'type' });
  }
  rejectProviderFields(value);
  const base = {
    id: Number.isSafeInteger(value.id) && value.id > 0 ? value.id : (() => { throw new AiValidationError("Event 'id' must be a positive integer.", { field: 'id' }); })(),
    type: value.type,
    turnId: requiredString(value.turnId, 'turnId'),
    timestamp: normalizeTimestamp(value.timestamp, 'timestamp'),
  };
  if (value.type === 'message.delta') {
    return { ...base, messageId: requiredString(value.messageId, 'messageId'), delta: requiredString(value.delta, 'delta', { opaque: true, max: 50_000 }) };
  }
  if (value.type === 'interaction.requested') {
    return { ...base, interaction: normalizeInteraction(value.interaction) };
  }
  if (value.type === 'interaction.resolved') {
    return { ...base, interactionId: requiredString(value.interactionId, 'interactionId') };
  }
  if (value.type === 'turn.failed') {
    return { ...base, error: { code: requiredString(value.error?.code, 'error.code'), message: requiredString(value.error?.message, 'error.message', { opaque: true, max: 2_000 }) } };
  }
  return { ...base, ...(value.messageId ? { messageId: requiredString(value.messageId, 'messageId') } : {}) };
}

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
