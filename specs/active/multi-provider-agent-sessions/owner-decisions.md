## D1: Multi-provider session architecture with capability model

- **Question:** How should differences between local agent CLIs (Claude, Antigravity, Codex) be represented in the backend and frontend?
- **Options considered:** Provider-specific branching in API and frontend | Lowest-common-denominator feature set | Provider-neutral contracts with dynamic `AgentCapabilities`
- **Decision:** Provider-neutral contracts with `AgentCapabilities`. Differences (such as interactive questions, permission prompts, reasoning streaming, tool call details) are declared by the provider adapter and handled generically by the UI. Invoking an unsupported operation throws a standard `CapabilityNotSupportedError`.
- **Consequences:** No provider-specific checks (`if (provider === 'claude')`) in public API or generic frontend components.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/contracts.mjs`, `tools/dashboard/src/lib/types.ts`, all areas.

## D2: Separation of Nevo session identity and provider process lifecycle

- **Question:** How should session state be persisted and mapped to local CLI processes?
- **Options considered:** One long-running background process per session | Stateless CLI calls with no session identity | Durable Nevo session mapped to `(provider, providerSessionId)` with short-lived turn processes
- **Decision:** Durable Nevo session mapped to `(provider, providerSessionId)`. Sessions survive turn execution; turn execution spawns/resumes short-lived CLI processes on demand.
- **Consequences:** Backend does not need to maintain heavyweight daemon processes when idle; CLI processes are cleanly re-attached via resume flags.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/service.mjs`, `tools/ai/turn-runtime.mjs`, `areas/provider-neutral-core.md`.

## D3: Frontend chat runtime library selection (`assistant-ui`)

- **Question:** How should the chat UI be developed given the complexity of streaming, tool calls, thinking, and message lifecycles?
- **Options considered:** Continue manual custom React chat development | Adopt `@assistant-ui/react` with a clean Nevo adapter | Adopt Vercel AI SDK UI directly
- **Decision:** Adopt `@assistant-ui/react` with a custom Nevo runtime adapter (`NevoAssistantRuntime`).
- **Rationale:** `@assistant-ui/react` supports React 19, provides robust message and thread mechanics, customizable primitives for tool calls and interactive controls, and separates the UI library from backend schemas via adapters.
- **Consequences:** Handcrafted chat mechanics in `tools/dashboard/src/components/ai-chat.tsx` are replaced by `@assistant-ui/react` primitives styled with NEvo design tokens.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/dashboard/package.json`, `tools/dashboard/src/components/ai-chat.tsx`, `areas/assistant-ui-frontend.md`.

## D4: Two-provider validation sequence (Claude first, Antigravity second)

- **Question:** In what order should providers be implemented to prove the abstraction?
- **Options considered:** Mock adapter only then Claude | Claude only | Claude as primary driver, followed immediately by Antigravity as mandatory validation
- **Decision:** Claude as the first vertical slice driver, followed by Antigravity as mandatory second provider before declaring the abstraction stable. Codex remains a future extension.
- **Consequences:** Part 1 delivers a fully working Claude slice; Part 3 validates Antigravity and executes a consistency review to eliminate any residual Claude bias.
- **Date:** 2026-08-17
- **Affected artifacts:** `change.yaml`, `overview.md`, `areas/antigravity-provider.md`.

## D5: Claude interaction transport via `PreToolUse/defer` roundtrip

- **Question:** How should Claude interactive questions (`AskUserQuestion`) and permission prompts be transported between the Claude CLI and NEvo?
- **Options considered:** Undocumented bidirectional stdin/stdout streaming within one running process | Custom user-prompt engine intercepting all tool uses | Officially supported `PreToolUse` deferral with process exit and resume with `updatedInput`
- **Decision:** Officially supported `PreToolUse/defer` flow. When Claude triggers `AskUserQuestion`, the hook defers tool execution (`stop_reason: "tool_deferred"`), the process exits, NEvo maps this to `interaction.requested`, and upon user response resumes the session with `updatedInput`.
- **Known Limitation:** `PreToolUse/defer` does not support interactive deferrals across parallel tool calls in a single batch (documented and tested constraint).
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/claude-adapter.mjs`, `areas/claude-provider.md`, Task 03, Task 05.

## D6: Unified session binding service and CLI execution context

- **Question:** How should AI sessions be bound to specifications and tasks across the CLI, hooks, and dashboard?
- **Options considered:** Duplicate attach logic in every CLI command and dashboard action | Store a single mutable `currentSessionId` per spec | Unified `AgentSessionBindingService` with `AgentExecutionContext` supporting many-to-one history
- **Decision:** A single shared `AgentSessionBindingService` and `AgentExecutionContext`. Resolves `spec-slug` or `spec-id` canonically to `specId`, maintains many-to-one historical session bindings, and supports auto-binding during CLI commands, hooks, and dashboard session creation.
- **Consequences:** All entry points (`agent-session attach`, `spec refine`, `spec review`, `task start`, dashboard) share identical binding logic and persist bindings locally in `.nevo-ai-local/sessions.json`.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/binding-service.mjs`, `areas/session-binding-and-context.md`, Task 02.

## D7: SSE Reconnect, Event Snapshot, and State Replay

- **Question:** How should the frontend handle SSE reconnection, page refreshes, and pending interactions?
- **Options considered:** Ephemeral stream with no history | Reconstructing process on reload | Session snapshot endpoint (`GET /api/agent-sessions/:sessionId`) plus pending interaction persistence in local state
- **Decision:** Provider owns full transcript history. NEvo maintains in-memory turn event buffers during active execution and persists session state (status, active turn, pending interaction) in `.nevo-ai-local/sessions.json`. Reconnecting clients fetch session snapshot and re-attach to the SSE event stream.
- **Consequences:** Reloading the dashboard restores the exact pending interaction and thread state without re-invoking the provider process.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/dashboard/server/ai-routes.mjs`, `tools/dashboard/src/lib/nevo-assistant-runtime.ts`, `areas/provider-neutral-core.md`.
