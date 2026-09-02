import { AiError } from './contracts.mjs';

export function createTrustedNetworkAiAccessPolicy() {
  return ({ capability }) => {
    if (capability !== 'read' && capability !== 'control') return false;
    return true;
  };
}

export function assertControlRequest(request) {
  if (request.headers['x-nevo-dashboard-action'] !== '1') {
    throw new AiError('AI_CONTROL_HEADER_REQUIRED', 'Dashboard action header is required.', { status: 403 });
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { throw new AiError('AI_ORIGIN_REJECTED', 'Request origin is invalid.', { status: 403 }); }
    // HTTP/2 uses the :authority pseudo-header; Fastify may expose it instead of host.
    const hostHeader = request.headers.host || request.headers[':authority'];
    if (originHost !== hostHeader) {
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
