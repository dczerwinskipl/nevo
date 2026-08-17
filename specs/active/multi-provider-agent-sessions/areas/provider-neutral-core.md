# Area: Provider-Neutral Core & Runtime

## Responsibilities

This area defines the common domain contracts, data models, capability system, turn runtime, and HTTP/SSE API layer for multi-provider agent sessions.

## 1. Domain Models & Identity

- **NevoSessionId:** UUID representing a durable session in NEvo. Belongs to a specification (`spec_id`) and optional `taskId`s.
- **Provider:** Enum/string identifier (`claude`, `antigravity`, `mock`, `codex`).
- **ProviderSessionId:** Internal session identifier managed by the provider CLI (e.g. Claude session UUID or Antigravity conversation ID). Kept strictly in the backend local registry; never exposed as public Nevo session identity.
- **Session Metadata:** Title, provider, status (`running`, `waitingForUser`, `idle`, `completed`), `lastActivityAt`, `spec_id`, `taskId`s, `workspaceDir`.

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

export interface AgentProvider {
  readonly id: string;
  readonly capabilities: AgentCapabilities;

  createSession(options: CreateSessionOptions): Promise<ProviderSessionRef>;
  resumeSession(options: ResumeSessionOptions): Promise<ProviderSessionRef>;
  startTurn(sessionRef: ProviderSessionRef, input: TurnInput): AsyncIterable<AgentEvent>;
  cancelTurn(sessionRef: ProviderSessionRef, turnId: string): Promise<void>;
  respondInteraction(sessionRef: ProviderSessionRef, response: InteractionResponse): Promise<void>;
}
```

## 3. Normalized Event Stream (`AgentEvent`)

All provider-specific stream deltas are normalized into standard events:

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

## 4. HTTP & SSE API Surface

- `GET /api/agent-sessions`: List sessions (supports filtering by `specId`).
- `POST /api/agent-sessions`: Create new session with provider selection.
- `GET /api/agent-sessions/:sessionId`: Get session details, metadata, and capabilities.
- `DELETE /api/agent-sessions/:sessionId`: Remove or archive session.
- `POST /api/agent-sessions/:sessionId/turns`: Start a new turn (with prompt, optional attachments).
- `POST /api/agent-sessions/:sessionId/turns/:turnId/cancel`: Cancel an active turn.
- `POST /api/agent-sessions/:sessionId/interactions/:interactionId/respond`: Submit user response to pending interaction.
- `GET /api/agent-sessions/:sessionId/events`: Server-Sent Events stream emitting normalized `AgentEvent` objects.

## 5. Local Storage & Concurrency

All session mappings and configuration are saved under `.nevo-ai-local/sessions.json`. Sessions support concurrent execution across different session IDs, with at most one active turn per session. Retried turn starts with identical idempotency keys return existing running `turnId`.
