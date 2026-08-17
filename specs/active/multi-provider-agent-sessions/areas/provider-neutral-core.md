# Area: Provider-Neutral Core & Runtime

## Responsibilities

This area defines the common domain contracts, data models, capability system, turn runtime, and HTTP/SSE API layer for multi-provider agent sessions.

## 1. Domain Models & Identity

- **NevoSessionId:** UUID representing a durable session in NEvo. Belongs to a specification (`specId`) and optional `taskId`s.
- **Provider:** Identifier string/enum (`claude`, `antigravity`, `mock`, `codex`).
- **ProviderSessionId:** Internal session identifier managed by the provider CLI (e.g. Claude session UUID or Antigravity conversation ID). Kept strictly in the backend local registry; never exposed as public Nevo session identity.
- **Session Metadata:** Title, provider, status (`running`, `waitingForUser`, `idle`, `completed`), `lastActivityAt`, `specId`, `taskId`s, `workspaceDir`.

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

  createSession(options: CreateSessionOptions): Promise<ProviderSessionRef>;
  resumeSession(options: ResumeSessionOptions): Promise<ProviderSessionRef>;
  startTurn(sessionRef: ProviderSessionRef, input: TurnInput): AsyncIterable<AgentEvent>;
  cancelTurn(sessionRef: ProviderSessionRef, turnId: string): Promise<void>;
  respondInteraction(sessionRef: ProviderSessionRef, response: InteractionResponse): Promise<void>;
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

## 4. HTTP & SSE API Surface

- `GET /api/agent-sessions`: List sessions (supports filtering by `specId` or `taskId`).
- `POST /api/agent-sessions`: Create new session with provider selection and optional spec/task binding.
- `GET /api/agent-sessions/:sessionId`: Get session details, metadata, capabilities, active turn, and pending interaction snapshot.
- `DELETE /api/agent-sessions/:sessionId`: Remove or archive session.
- `POST /api/agent-sessions/:sessionId/turns`: Start a new turn (with prompt, optional attachments).
- `POST /api/agent-sessions/:sessionId/turns/:turnId/cancel`: Cancel an active turn.
- `POST /api/agent-sessions/:sessionId/interactions/:interactionId/respond`: Submit user response to pending interaction.
- `GET /api/agent-sessions/:sessionId/events`: Server-Sent Events stream emitting normalized `AgentEvent` objects (supports reconnection).

## 5. Reconnect & Transcript Semantics

- **Source of Truth:** The provider CLI retains full conversation history.
- **Turn Buffering:** NEvo maintains an in-memory event buffer for active turns.
- **State Reconnection:** When the frontend reloads or reconnects SSE:
  1. `GET /api/agent-sessions/:sessionId` delivers the current state snapshot (including any pending `interactionId` and turn status).
  2. `GET /api/agent-sessions/:sessionId/events` resumes listening for live events.
  3. If an interaction was pending, the dashboard displays the interactive form immediately without re-invoking the provider process.
- **Short-Lived Turn Lifecycle:** Turns spawn a short-lived process. Deferrals exit the process; user responses trigger a new resumed process.
