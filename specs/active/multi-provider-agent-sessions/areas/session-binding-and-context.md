# Area: Session Binding & Agent Execution Context

## Responsibilities

This area defines the shared, provider-neutral session binding service and CLI execution context that associates local agent sessions `(provider, providerSessionId)` with NEvo specifications and tasks.

## 1. Domain Model

```ts
export interface AgentIdentity {
  provider: string;           // 'claude', 'antigravity', 'mock'
  providerSessionId: string;  // Provider-managed internal session ID
}

export interface AgentSessionBinding {
  provider: string;
  providerSessionId: string;
  specId: string;             // Canonical UUID
  taskId?: string;            // Optional task ID
  purpose?: string;           // e.g. 'refinement', 'review', 'implementation', 'ad-hoc'
  createdAt: string;
  lastSeenAt: string;
}

export interface AgentExecutionContext {
  provider: string;
  providerSessionId: string;
}
```

## 2. Canonical Spec & Task Resolution

- The binding service accepts either `spec-slug` or `spec_id` UUID.
- A common resolver resolves human-readable slugs (`change.id`) or UUIDs (`spec_id`) into a canonical `specId` before reading or storing bindings.
- Task identifiers are validated against the manifest tasks if present.

## 3. Shared Binding Service (`AgentSessionBindingService`)

A single backend service responsible for:
- `bindSession(binding: AgentSessionBinding): Promise<AgentSessionBinding>`
- `listBindings(query: { specId?: string; taskId?: string }): Promise<AgentSessionBinding[]>`
- `getBinding(provider: string, providerSessionId: string): Promise<AgentSessionBinding | null>`
- `unbindSession(provider: string, providerSessionId: string): Promise<void>`
- Persisting mappings locally in `.nevo-ai-local/sessions.json`.
- **Deduplication Semantics:** Repeatedly binding the same `(provider, providerSessionId)` to the same scope updates `lastSeenAt` and `purpose` idempotently without creating duplicate records.

All entry points (CLI `agent-session attach`, lifecycle commands, dashboard session creation, provider hooks) delegate directly to this service — no duplicated binding logic.

## 4. CLI Execution Context & Auto-Binding

- CLI commands accept an optional execution context via environment variables:
  `NEVO_AGENT_PROVIDER=claude NEVO_AGENT_PROVIDER_SESSION_ID=<uuid>`
- When commands such as `spec refine`, `spec review`, or `task start` execute within an agent session, they automatically register or update the binding between `(provider, providerSessionId)` and the targeted `specId` / `taskId`.
- CLI commands provide a standalone attachment utility:
  `node tools/specs.mjs agent-session attach --spec <slug-or-id> [--task <id>] --provider claude --session-id <providerSessionId>`

## 5. Many-to-One / History-Oriented Association

- A single specification or task can be associated with multiple agent sessions over time (e.g. initial implementation in Claude, review in Gemini, bugfix in Claude).
- If a session initially bound only to a specification begins work on a specific task, the binding record is updated with the `taskId` and `purpose` while retaining its canonical `specId` and history.
- Bindings are strictly stored in local user storage (`.nevo-ai-local/`) and never committed to version control. Two developers working on the same branch maintain independent local session bindings.
