interface BrowserCrypto {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint32Array) => Uint32Array;
}

export interface DisplayTranscriptMessage {
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

export interface SpecContextInfo {
  slug: string;
  title?: string;
  goal?: string;
  tasks?: Array<{ id: string; title?: string }>;
  isPlanning?: boolean;
}

export function initialPromptWithTaskContext(
  message: string,
  taskIds: string[] = [],
  specContext?: SpecContextInfo,
): string | null {
  const request = message.trim();
  if (!request && !specContext) return null;

  const headerLines: string[] = [];

  if (specContext?.slug) {
    headerLines.push(`[NEvo Context: Specification '${specContext.slug}']`);
    if (specContext.title) {
      headerLines.push(`Title: "${specContext.title}"`);
    }
    headerLines.push(`Location: specs/active/${specContext.slug}/`);
    if (specContext.isPlanning) {
      headerLines.push(`Status: draft (skeleton created: change.yaml, overview.md)`);
      headerLines.push(`Scope: Specification refinement and task planning`);
    } else if (taskIds.length > 0) {
      const taskLabels = taskIds.map((id) => {
        const found = specContext.tasks?.find((t) => t.id === id);
        return found?.title ? `${id} ("${found.title}")` : id;
      });
      headerLines.push(`Focus Tasks: ${taskLabels.join(', ')}`);
    } else {
      headerLines.push(`Scope: Full specification`);
    }
    if (specContext.goal?.trim()) {
      headerLines.push(`Goal: ${specContext.goal.trim()}`);
    }
  } else if (taskIds.length > 0) {
    headerLines.push(`Context: tasks ${taskIds.join(', ')}`);
  }

  const contextHeader = headerLines.join('\n');
  if (!request) {
    if (specContext?.isPlanning) {
      return `${contextHeader}\n\nPlease review the skeleton files (overview.md, change.yaml) and help me plan and refine this specification according to NEvo guidelines.`;
    }
    return contextHeader
      ? `${contextHeader}\n\nPlease review the current specification and task state and let me know how you can assist.`
      : null;
  }

  return contextHeader ? `${contextHeader}\n\n${request}` : request;
}

export function composeTranscriptMessages(
  persisted: DisplayTranscriptMessage[],
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
