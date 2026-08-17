# Area: Session Binding & Agent Execution Context

## Responsibilities

This area defines the shared, provider-neutral session binding service and CLI execution context that associates local agent sessions `(provider, providerSessionId)` with NEvo specifications and tasks at the shared execution boundary of the repository's tooling.

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
- Task identifiers are validated against manifest tasks if present.

## 3. Shared Binding Service (`AgentSessionBindingService`)

A single backend service responsible for:
- `bindSession(binding: AgentSessionBinding): Promise<AgentSessionBinding>`
- `listBindings(query: { specId?: string; taskId?: string }): Promise<AgentSessionBinding[]>`
- `getBinding(provider: string, providerSessionId: string): Promise<AgentSessionBinding | null>`
- `unbindSession(provider: string, providerSessionId: string): Promise<void>`
- Persisting mappings locally in `.nevo-ai-local/sessions.json`.
- **Deduplication Semantics:** Repeatedly binding the same `(provider, providerSessionId)` to the same scope updates `lastSeenAt` and `purpose` idempotently without creating duplicate records.

## 4. Real Tooling Execution Boundary & Auto-Binding

- Agent-driven workflows (such as specification refinement, review, task implementation) drive the Node lifecycle CLI (`tools/specs.mjs` commands: `context`, `approve`, `start`, `complete`, `verify`, etc.).
- `AgentExecutionContext` is injected via environment variables:
  `NEVO_AGENT_PROVIDER=claude NEVO_AGENT_PROVIDER_SESSION_ID=<uuid>`
- Instead of implementing special-case binding logic in individual commands, the execution context is integrated at the shared practical execution boundary in `tools/specs.mjs` (e.g. command pre-action lifecycle / change-loading pipeline). When an agent runs tooling with a known `specId`/`taskId`, the session binding is automatically registered or refreshed in `AgentSessionBindingService`.
- If a command does not yet know the spec identity (e.g. creating a new spec), the binding is recorded as soon as the canonical spec identity is established.

## 5. Explicit CLI Attach Fallback

- CLI provides a standalone attachment utility:
  `node tools/specs.mjs agent-session attach --spec <slug-or-id> [--task <id>] --provider <provider> --session-id <providerSessionId>`

## 6. Many-to-One / History-Oriented Association

- A single specification or task can be associated with multiple agent sessions over time.
- Bindings are strictly stored in local user storage (`.nevo-ai-local/`) and never committed to version control. Two developers working on the same branch maintain independent local session bindings.
