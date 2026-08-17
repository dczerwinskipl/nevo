## D1: Multi-provider session architecture with capability model

- **Question:** How should differences between local agent CLIs (Claude, Antigravity, Codex) be represented in the backend and frontend?
- **Options considered:** Provider-specific branching in API and frontend | Lowest-common-denominator feature set | Provider-neutral contracts with dynamic `AgentCapabilities`
- **Decision:** Provider-neutral contracts with `AgentCapabilities`. Differences (such as interactive questions, permission prompts, reasoning streaming, tool call details) are declared by the provider adapter and handled generically by the UI. Invoking an unsupported operation throws a standard `CapabilityNotSupportedError`.
- **Consequences:** No provider-specific checks (`if (provider === 'claude')`) in public API or generic frontend components.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/contracts.mjs`, `tools/dashboard/src/lib/types.ts`, all areas.

## D2: Providers own AI session identity and lifecycle

- **Question:** Should NEvo invent a synthetic session model and lifecycle state machine layered over provider sessions?
- **Options considered:** Synthetic Nevo session lifecycle with `nevoSessionId` | Providers own session identity and lifecycle; Nevo identifies sessions by `(provider, providerSessionId)` and stores local spec/task bindings
- **Decision:** Providers own AI session identity and lifecycle. Nevo identifies a session by `(provider, providerSessionId)` and stores only local bindings between provider sessions and specs/tasks. Short-lived process execution is an adapter concern and does not create a separate Nevo session lifecycle.
- **Consequences:** Backend does not manage long-running daemon processes, synthetic session IDs, or dual session states; turn execution spawns/resumes CLI processes on demand via provider adapters.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/contracts.mjs`, `tools/ai/service.mjs`, `tools/ai/binding-service.mjs`, all areas.

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

## D5: Claude AskUserQuestion interaction transport

- **Question:** How should Claude interactive questions (`AskUserQuestion`) be transported between the Claude CLI and NEvo?
- **Options considered:** Undocumented bidirectional stdin/stdout streaming within one running process | Custom user-prompt engine intercepting all tool uses | Officially supported `PreToolUse` deferral with process exit and resume with `updatedInput`
- **Decision:** `PreToolUse/defer` flow. When Claude triggers `AskUserQuestion`, the hook defers tool execution (`stop_reason: "tool_deferred"`), the process exits, NEvo maps this to `interaction.requested` (kind: `question`), and upon user response resumes the session (`claude --resume <providerSessionId>`) providing `updatedInput` to the hook.
- **Native Permissions Status:** Native permission transport remains unresolved until Task 03 discovery and is intentionally not decided by D5.
- **Known Limitation:** `PreToolUse/defer` does not support interactive deferrals across parallel tool calls in a single batch (documented and tested constraint).
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/claude-adapter.mjs`, `areas/claude-provider.md`, Task 03, Task 05.

## D6: Unified session binding service and real tooling execution path

- **Question:** How should AI sessions be bound to specifications and tasks across the CLI, hooks, and dashboard?
- **Options considered:** Duplicate attach logic in every CLI command handler | Store a single mutable `currentSessionId` per spec | Unified `AgentSessionBindingService` integrated at the lowest shared practical execution boundary in `tools/specs.mjs`
- **Decision:** A single shared `AgentSessionBindingService` and `AgentExecutionContext`. Resolves `spec-slug` or `spec-id` canonically to `specId`, maintains many-to-one historical session bindings of `(provider, providerSessionId)`, and integrates `AgentExecutionContext` (`NEVO_AGENT_PROVIDER`, `NEVO_AGENT_PROVIDER_SESSION_ID`) into the shared command execution boundary of `tools/specs.mjs` so agent-driven workflows automatically bind active sessions. Explicit fallback provided via `node tools/specs.mjs agent-session attach`.
- **Consequences:** All entry points share identical binding logic and persist bindings locally in `.nevo-ai-local/sessions.json`.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/ai/binding-service.mjs`, `areas/session-binding-and-context.md`, Task 02.

## D7: Normalized UI read-model cache, SSE Reconnect, and Page Reload

- **Question:** How should the dashboard restore conversation thread history, handle SSE reconnection, and correlate pending interactions across page reloads without creating a synthetic Nevo session lifecycle?
- **Options considered:** Ephemeral stream with no history | Re-executing provider on reload | Provider owns conversation session lifecycle, while NEvo maintains a local normalized UI read-model cache
- **Decision:** Providers remain the sole source of truth for session continuation and lifecycle. NEvo maintains a local, provider-neutral normalized UI read-model cache under `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json` storing normalized messages, completed turn events, and active interaction state with monotonic sequence cursor (`lastEventSeq`). On page reload or server restart, the dashboard fetches the normalized thread snapshot (`GET /api/agent-sessions/:provider/:providerSessionId`), initializes the `@assistant-ui/react` thread, displays any correlated pending interaction card, connects to the SSE stream (`GET /events`), and applies only events newer than the snapshot cursor to eliminate duplicate events.
- **Consequences:** Page refresh restores the full chat UI and pending interaction cards instantly without restarting or re-invoking provider processes.
- **Date:** 2026-08-17
- **Affected artifacts:** `tools/dashboard/server/ai-routes.mjs`, `tools/dashboard/src/lib/nevo-assistant-runtime.ts`, `areas/provider-neutral-core.md`, `areas/assistant-ui-frontend.md`.
