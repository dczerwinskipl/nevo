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

  startTurn(identity: AgentIdentity, input: TurnInput): AsyncIterable<AgentEvent>;
  cancelTurn(identity: AgentIdentity, turnId: string): Promise<void>;
  respondInteraction(identity: AgentIdentity, response: InteractionResponse): Promise<void>;
}
```

- If an unsupported method is called on a provider (e.g. `respondInteraction` when `interactivePermissions` and `interactiveQuestions` are false), the provider throws `CapabilityNotSupportedError`.

## 3. Normalized Event Stream (`AgentEvent`)

All provider-specific stream deltas are normalized into standard events using `text.delta`:

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
    updatedAt: string;
  }
  ```
- **Update Lifecycle:** Updated automatically upon `interaction.requested`, `turn.completed`, or `turn.failed`.
- **Page Reload:** Dashboard fetches `GET /api/agent-sessions/:provider/:providerSessionId` (snapshot, pending interaction, and normalized thread history with `lastEventSeq`), immediately populating the `@assistant-ui/react` thread.

## 5. HTTP & SSE API Surface

- `GET /api/agent-sessions`: List session bindings (supports filtering by query parameters `specId` or `taskId`).
- `POST /api/agent-sessions`: Register a session binding or start a new provider session with initial spec/task binding.
- `GET /api/agent-sessions/:provider/:providerSessionId`: Get session details, binding metadata, capabilities, active turn, pending interaction snapshot, and normalized message thread history with `lastEventSeq` cursor.
- `DELETE /api/agent-sessions/:provider/:providerSessionId`: Remove local session binding.
- `POST /api/agent-sessions/:provider/:providerSessionId/turns`: Start a new turn (with prompt, optional attachments).
- `POST /api/agent-sessions/:provider/:providerSessionId/turns/:turnId/cancel`: Cancel an active turn.
- `POST /api/agent-sessions/:provider/:providerSessionId/interactions/:interactionId/respond`: Submit user response to pending interaction.
- `GET /api/agent-sessions/:provider/:providerSessionId/events`: Server-Sent Events stream emitting normalized `AgentEvent` objects.

## 6. SSE Reconnection & Event Deduplication

- Client connects to SSE stream after populating thread history.
- Events carry monotonic turn sequence numbers or timestamps. The client runtime ignores events already reflected in the loaded history snapshot, preventing duplicated tokens or tool cards.
