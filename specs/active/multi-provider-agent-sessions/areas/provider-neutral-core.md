# Area: Provider-Neutral Core & Runtime

## Responsibilities

This area defines the common domain contracts, data models, capability system, turn runtime, normalized UI read-model cache, and HTTP/SSE API layer for multi-provider agent sessions.

## 1. Domain Models & Canonical Identity

Nevo does not own AI session lifecycles. Sessions are owned by providers and canonically identified by:

```ts
export interface AgentIdentity {
  provider: string;           // 'claude', 'antigravity', 'mock'
  providerSessionId: string;  // Provider-managed internal session ID
}
```

- **Canonical Identity:** The pair `(provider, providerSessionId)` is the single identifier used across backend APIs, routing, and bindings.
- **No Synthetic Nevo Session ID:** No `nevoSessionId` or synthetic session state layer is introduced.
- **Provider-Owned Lifecycle:** Session state, continuation, and process execution are managed by providers and their backend adapters.

## 2. Provider Interface & Capability Model

```ts
export interface AgentCapabilities {
  interactivePermissions: boolean;
  interactiveQuestions: boolean;
  interactiveConfirmations: boolean;
  resumeSession: boolean;
  cancelTurn: boolean;
  toolCalls: boolean;
  reasoning: boolean;
  usage: boolean;
}

export class CapabilityNotSupportedError extends Error {
  constructor(provider: string, capability: keyof AgentCapabilities) {
    super(`Provider '${provider}' does not support capability '${capability}'.`);
    this.name = 'CapabilityNotSupportedError';
  }
}

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: AgentCapabilities;

  startTurn(input: {
    turnId: string;
    providerSessionId?: string;
    message: string;
    prompt?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
  }): Promise<{ providerSessionId?: string; isDeferred?: boolean; interaction?: unknown; [key: string]: unknown }> | AsyncIterable<AgentEvent>;

  cancelTurn(input: { turnId: string; providerSessionId?: string; operation?: unknown }): Promise<void>;

  respondInteraction?(input: {
    turnId: string;
    providerSessionId: string;
    interactionId: string;
    interaction?: unknown;
    response: unknown;
    signal?: AbortSignal;
    [key: string]: unknown;
  }): Promise<{ isDeferred?: boolean; interaction?: unknown; [key: string]: unknown }> | AsyncIterable<AgentEvent>;
}
```

- If an unsupported method is called on a provider (e.g. `respondInteraction` when `interactivePermissions` and `interactiveQuestions` are false), the provider throws `CapabilityNotSupportedError`.


## 3. Normalized Event Stream (`AgentEvent`)

All provider-specific stream deltas are normalized into standard events using `text.delta`. Event sequences (`seq`, `id`) are **strictly monotonic per `(provider, providerSessionId)`** across all turns and continuation execution segments:

- `turn.started`: `{ turnId, timestamp }`
- `message.started`: `{ messageId, role: 'assistant' | 'user', timestamp }`
- `text.delta`: `{ text }`
- `reasoning.delta`: `{ text }`
- `tool.started`: `{ toolId, toolName, input }`
- `tool.updated`: `{ toolId, output, status }`
- `tool.completed`: `{ toolId, output, durationMs }`
- `interaction.requested`: `{ interactionId, kind: 'permission' | 'question' | 'confirmation', payload }`
- `interaction.resolved`: `{ interactionId, response }`
- `usage.updated`: `{ tokensIn, tokensOut, cost }`
- `turn.completed`: `{ turnId, durationMs, finishReason }`
- `turn.failed`: `{ turnId, error: { message, code } }`

## 4. Normalized UI Read-Model Cache & Thread Persistence

While providers are the source of truth for session continuity, NEvo maintains a provider-neutral normalized UI read-model cache to allow instant thread restoration in the dashboard across page reloads without re-invoking provider processes:

- **Storage Location:** `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`.
- **Data Model:**
  ```ts
  export interface NormalizedMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    reasoning?: string;
    toolCalls?: Array<{ id: string; name: string; input: unknown; output?: unknown; status: string }>;
    interaction?: { id: string; kind: string; payload: unknown; response?: unknown };
    createdAt: string;
  }
  export interface SessionTranscriptCache {
    provider: string;
    providerSessionId: string;
    messages: NormalizedMessage[];
    activeTurn?: { turnId: string; startedAt: string };
    pendingInteraction?: { interactionId: string; kind: string; payload: unknown };
    lastEventSeq: number;
    updatedAt: string;
  }
  ```
- **Update Lifecycle & Invariant:** The read-model is updated incrementally as normalized `AgentEvent`s are applied (accumulating assistant text deltas, tool calls and outputs, reasoning segments, interaction states, turn state, and advancing `lastEventSeq`). To optimize disk I/O, implementations may employ batching, debouncing, or atomic flush strategies, but must preserve the invariant:
  $$\text{lastEventSeq in persisted snapshot} = \text{highest AgentEvent sequence represented by the persisted normalized thread state}$$
- **Page Reload & SSE Deduplication Flow:**
  1. Dashboard loads persisted snapshot from `GET /api/agent-sessions/:provider/:providerSessionId` (including `messages`, `pendingInteraction`, and `lastEventSeq`).
  2. Initializes `@assistant-ui/react` thread state and displays any pending interaction card.
  3. Connects to SSE event stream `GET /api/agent-sessions/:provider/:providerSessionId/events`.
  4. Applies only live events where $\text{event.seq} > \text{lastEventSeq}$, guaranteeing zero duplicate tokens, messages, or tool cards.

## 5. HTTP & SSE API Surface

- `GET /api/agent-sessions`: List session bindings (supports filtering by query parameters `specId` or `taskId`).
- `POST /api/agent-sessions`: Attach an existing pre-allocated session `(provider, providerSessionId)` to a spec/task binding.
- `POST /api/agent-sessions/turns`: Start initial turn in a new thread without pre-existing session ID (with `{ provider, message, specId?, taskId? }`, returns `{ turnId, providerSessionId }`).
- `GET /api/agent-sessions/:provider/:providerSessionId`: Get session details, binding metadata, capabilities, active turn, pending interaction snapshot, and normalized message thread history with `lastEventSeq` cursor.
- `DELETE /api/agent-sessions/:provider/:providerSessionId`: Remove local session binding.
- `POST /api/agent-sessions/:provider/:providerSessionId/turns`: Start a subsequent turn on an existing session (with prompt, optional attachments).
- `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel`: Cancel an active turn.
- `POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond`: Submit user response to pending interaction (starts continuation execution under active turn).
- `GET /api/agent-sessions/:provider/:providerSessionId/events`: Server-Sent Events stream emitting session-wide normalized `AgentEvent` objects (carrying monotonic sequence `seq`).


## 6. SSE Reconnection & Event Deduplication

- Client connects to session SSE stream after populating thread history.
- Events carry monotonic session sequence numbers (`seq`). The client runtime filters out any events with $\text{seq} \le \text{lastEventSeq}$ already present in the initial snapshot, preventing duplicated tokens or tool cards across reconnects and server restarts.

