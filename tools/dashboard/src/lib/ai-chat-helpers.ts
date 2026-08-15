interface BrowserCrypto {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint32Array) => Uint32Array;
}

export interface DisplayChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export function createTurnIdempotencyKey({
  cryptoSource = globalThis.crypto as BrowserCrypto | undefined,
  now = Date.now,
  random = Math.random,
}: {
  cryptoSource?: BrowserCrypto;
  now?: () => number;
  random?: () => number;
} = {}) {
  try {
    if (typeof cryptoSource?.randomUUID === 'function') return `ui-${cryptoSource.randomUUID()}`;
    const values = new Uint32Array(4);
    cryptoSource?.getRandomValues?.(values);
    const entropy = [...values].map(value => value.toString(36)).join('-');
    if (entropy && values.some(value => value !== 0)) return `ui-${now().toString(36)}-${entropy}`;
  } catch {
    // Non-secure HTTP origins may expose crypto without usable random APIs.
  }
  return `ui-${now().toString(36)}-${random().toString(36).slice(2)}`;
}

export function initialPromptWithTaskContext(message: string, taskIds: string[]) {
  const request = message.trim();
  if (!request) return null;
  if (!taskIds.length) return request;
  return `Context: tasks ${taskIds.join(', ')}\n\n${request}`;
}

export function composeChatMessages(
  persisted: DisplayChatMessage[],
  optimisticUser: string | null,
  liveDeltas: Readonly<Record<string, string>>,
) {
  const persistedIds = new Set(persisted.map(message => message.id));
  return [
    ...persisted,
    ...(optimisticUser ? [{ id: 'optimistic-user', role: 'user' as const, text: optimisticUser }] : []),
    ...Object.entries(liveDeltas)
      .filter(([id]) => !persistedIds.has(id))
      .map(([id, text]) => ({ id, role: 'assistant' as const, text })),
  ];
}
