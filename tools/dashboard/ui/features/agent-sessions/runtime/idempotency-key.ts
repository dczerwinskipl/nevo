/**
 * Generates an opaque, client-side idempotency key for starting a canonical Turn.
 * Formatted as `${prefix}-${timestamp36}-${random36}`.
 */
export function createTurnIdempotencyKey(prefix = 'turn'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}
