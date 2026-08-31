import { AiValidationError, normalizeTimestamp } from '../contracts.mjs';

export const TRACE_SCHEMA_VERSION = 1;

export const TRACE_SOURCES = Object.freeze([
  'runtime',
  'coordinator',
  'adapter',
  'providerProcess',
  'tool',
  'persistence',
  'http',
  'sse',
]);

export const TRACE_DISPOSITIONS = Object.freeze([
  'accepted',
  'suppressed',
  'ignored',
  'late',
]);

export const TIMEOUT_KINDS = Object.freeze([
  'startup',
  'protocol-silence',
  'tool',
  'max-turn',
  'cleanup',
  'flush',
]);

export const PROCESS_STATES = Object.freeze([
  'spawned',
  'running',
  'exiting',
  'exited',
  'terminating',
  'released',
  'releaseFailed',
]);

const PROHIBITED_METADATA_KEYS = new Set([
  'prompt',
  'answer',
  'text',
  'reasoning',
  'input',
  'output',
  'command',
  'rawpayload',
  'rawdetails',
  'password',
  'token',
  'secret',
  'apikey',
  'credential',
]);

function isProhibitedKey(key) {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  if (PROHIBITED_METADATA_KEYS.has(normalized)) return true;
  return /password|token|secret|credential|rawpayload|provider.*id|apikey/i.test(normalized);
}

export function sanitizeTraceMetadata(value, depth = 0) {
  if (value == null || typeof value !== 'object' || depth > 4) return undefined;
  if (Array.isArray(value)) {
    return value
      .map(v => (typeof v === 'object' ? sanitizeTraceMetadata(v, depth + 1) : v))
      .filter(v => v !== undefined);
  }

  const sanitized = {};
  for (const [k, v] of Object.entries(value)) {
    if (isProhibitedKey(k)) {
      continue;
    }
    if (v && typeof v === 'object') {
      const nested = sanitizeTraceMetadata(v, depth + 1);
      if (nested !== undefined && Object.keys(nested).length > 0) {
        sanitized[k] = nested;
      }
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      // String values bounded to 500 chars
      sanitized[k] = typeof v === 'string' ? (v.length > 500 ? `${v.slice(0, 500)}...` : v) : v;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function validateTraceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new AiValidationError('LifecycleTraceRecord must be an object.');
  }

  if (record.schemaVersion !== TRACE_SCHEMA_VERSION) {
    throw new AiValidationError(
      `LifecycleTraceRecord schemaVersion must be ${TRACE_SCHEMA_VERSION}.`,
      { field: 'schemaVersion', value: record.schemaVersion },
    );
  }

  if (!Number.isSafeInteger(record.seq) || record.seq < 1) {
    throw new AiValidationError("LifecycleTraceRecord 'seq' must be a positive integer >= 1.", { field: 'seq', value: record.seq });
  }

  const timestamp = normalizeTimestamp(record.timestamp, 'timestamp');
  const elapsedMs = typeof record.elapsedMs === 'number' && record.elapsedMs >= 0 ? record.elapsedMs : 0;

  if (typeof record.turnId !== 'string' || record.turnId.length === 0) {
    throw new AiValidationError("LifecycleTraceRecord 'turnId' must be a non-empty string.", { field: 'turnId' });
  }
  const effectiveSessionId = record.sessionId || record.providerSessionId || record.turnId;
  if (typeof effectiveSessionId !== 'string' || effectiveSessionId.length === 0) {
    throw new AiValidationError("LifecycleTraceRecord 'sessionId' must be a non-empty string.", { field: 'sessionId' });
  }
  if (typeof record.provider !== 'string' || record.provider.length === 0) {
    throw new AiValidationError("LifecycleTraceRecord 'provider' must be a non-empty string.", { field: 'provider' });
  }

  const source = TRACE_SOURCES.includes(record.source) ? record.source : 'runtime';
  if (typeof record.event !== 'string' || record.event.length === 0) {
    throw new AiValidationError("LifecycleTraceRecord 'event' must be a non-empty string.", { field: 'event' });
  }

  let disposition = undefined;
  if (record.disposition != null) {
    if (!TRACE_DISPOSITIONS.includes(record.disposition)) {
      throw new AiValidationError(
        `LifecycleTraceRecord 'disposition' must be one of: ${TRACE_DISPOSITIONS.join(', ')}.`,
        { field: 'disposition', value: record.disposition },
      );
    }
    disposition = record.disposition;
  }

  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    seq: record.seq,
    timestamp,
    elapsedMs,
    turnId: record.turnId,
    sessionId: effectiveSessionId,
    provider: record.provider,
    ...(record.providerSessionId ? { providerSessionId: String(record.providerSessionId) } : {}),
    source,
    event: record.event,
    ...(disposition ? { disposition } : {}),
    ...(record.beforeStatus ? { beforeStatus: record.beforeStatus } : {}),
    ...(record.afterStatus ? { afterStatus: record.afterStatus } : {}),
    ...(record.initiator ? { initiator: String(record.initiator) } : {}),
    ...(record.cause ? { cause: String(record.cause) } : {}),
    ...(record.subjectId ? { subjectId: String(record.subjectId) } : {}),
    ...(record.timeout ? { timeout: structuredClone(record.timeout) } : {}),
    ...(record.process ? { process: structuredClone(record.process) } : {}),
    ...(record.persistence ? { persistence: structuredClone(record.persistence) } : {}),
    ...(record.metadata ? { metadata: sanitizeTraceMetadata(record.metadata) } : {}),
  };
}

export function createTraceRecord({
  seq,
  turnId,
  sessionId,
  provider,
  providerSessionId,
  source = 'runtime',
  event,
  disposition,
  beforeStatus,
  afterStatus,
  initiator,
  cause,
  subjectId,
  timeout,
  process,
  persistence,
  metadata,
  timestamp = new Date().toISOString(),
  elapsedMs = 0,
}) {
  return validateTraceRecord({
    schemaVersion: TRACE_SCHEMA_VERSION,
    seq,
    timestamp,
    elapsedMs,
    turnId,
    sessionId,
    provider,
    providerSessionId,
    source,
    event,
    disposition,
    beforeStatus,
    afterStatus,
    initiator,
    cause,
    subjectId,
    timeout,
    process,
    persistence,
    metadata,
  });
}
