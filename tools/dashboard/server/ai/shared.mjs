import { AiError, AiValidationError, publicAiError } from '../../../ai/contracts.mjs';

export const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
export const TURN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `request.params` values are already decoded once by Fastify/find-my-way
// (`safeDecodeURIComponent`) — only the shape needs validating here, not a
// second decode.
export function validatedSegment(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new AiValidationError(`Invalid ${label}.`);
  return value;
}

function containsControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isC0 = code >= 0 && code <= 31;
    const isDel = code === 127;
    if (isC0 || isDel) return true;
  }
  return false;
}

export function validatedSessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || containsControlCharacter(value)) {
    throw new AiValidationError('Invalid session ID.');
  }
  return value;
}

export function assertBodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AiValidationError('Request body must be a JSON object.');
  }
  return body;
}

export function assertControlRequest(request) {
  if (request.headers['x-nevo-dashboard-action'] !== '1') {
    throw new AiError('AI_CONTROL_HEADER_REQUIRED', 'Dashboard action header is required.', { status: 403 });
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { throw new AiError('AI_ORIGIN_REJECTED', 'Request origin is invalid.', { status: 403 }); }
    if (originHost !== request.headers.host) {
      throw new AiError('AI_ORIGIN_REJECTED', 'Cross-origin AI control requests are not allowed.', { status: 403 });
    }
  }
}

export function authorize(accessPolicy, capability, request) {
  if (accessPolicy({ capability, request, mode: 'trusted-network' }) !== true) {
    throw new AiError('AI_ACCESS_DENIED', 'AI access is not allowed.', { status: 403 });
  }
  if (capability === 'control') assertControlRequest(request);
}

// Scoped to the AI plugin only (see ai/routes.mjs) — everything here is
// AI-domain error *shape* mapping, kept out of the small, generic app-level
// handler in infrastructure/http.mjs. JSON parsing itself is Fastify's own
// standard `application/json` support, applied once at the application
// boundary — the AI plugin inherits it rather than registering an
// equivalent parser of its own; this handler is what turns a shared
// transport-level parse/size error (already carrying its own `statusCode`)
// into the AI response shape (`{ error: { code, message } }`) callers of
// this capability expect.
export function aiErrorHandler(error, request, reply) {
  if (error?.name === 'HttpError' || error?.name === 'SpecificationActionError') {
    reply.code(error.status || 400).send({ error: { code: 'AI_VALIDATION_ERROR', message: error.message } });
    return;
  }
  if (typeof error?.statusCode === 'number' && error.statusCode < 500) {
    reply.code(error.statusCode).send({ error: { code: 'AI_VALIDATION_ERROR', message: error.message } });
    return;
  }
  const normalized = publicAiError(error);
  reply.code(normalized.status).send(normalized.toJSON());
}
