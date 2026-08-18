---
review-of: spec
change: multi-provider-agent-sessions
generated: 2026-08-17
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 665ac9a153403be78ebd8e43fb6cb28c5ada2e2419de18cd76a909e24f9605bd
task_fingerprints:
  provider-neutral-core-and-capabilities: 43398bc2fb27fa5a7debe9706cb5fb35a408111e0672e23fb7068506115de773
  session-binding-and-execution-context: c4de81d3f56d5b83433665759d01a2dcdf0b1f5faca49500a3765c401572b304
  claude-interaction-transport-discovery: eaf69325659496418c14a0bf0d730a1ff8bc2d88c63ebad5a900a8a15650b754
  claude-provider-adapter: 86b37fdd9e06c2211f2b2da132384409cc32f2f1fda7829a1df5d41882b231d9
  claude-interaction-and-deferral: 1809b913b9675aead2b0e3d4bb4f29f171e10302f53a669ab156cf6606e8fb7e
  agent-session-http-sse-api: af56e586af9fafbc2fba074dbd07e8a8da870e55431e740aeed5f312ee4c8108
  assistant-ui-integration-and-adapter: 799d8fce6ae11b9953d5eeb43290f496af84de16993cf7b21b9211b80c4c02be
  custom-renderers-and-interaction-ui: 8960f28a8864503d94f785d1c817ae1eb173f158f0a098f361e43b60c3424322
  dashboard-session-ux-and-spec-binding: 4f657080a956f5316d3c71c4fdec3f2e4776e2987e4b1a4f6c6348c867f79485
  antigravity-adapter-and-events: c94fc2329e0128c9be0d862a14f1875061d0fe2f9d0bf3ac93aa2ba7accb11c7
  multi-provider-consistency-audit-and-refinement: 34561999ef32a1c32ca8e43bab1409ed7bd56f9fa278bf124fd2f0a74ccce46a
  final-verification-and-architecture-docs: 0ca5c1fab0bb1b1484a7fbbfe97b8c5b5614e3d26497b9447cfd37680e68e76f
  agent-execution-modes-and-permissions: d312e52d3f5e0ef3793fb598b4c617d30afc7d8e5e43784fcea4ef89e7a60642
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification:
- **`AskUserQuestion` vs Native Permissions:** `AskUserQuestion` is definitively resolved as `PreToolUse/defer` roundtrip. Native Claude permission prompt transport remains unresolved until Task 03 discovery (`--permission-prompt-tool` vs `PreToolUse/defer` vs `canUseTool`).
- **Normalized UI Read-Model Cache & Reconnect:** Providers own conversation continuity. NEvo maintains a local normalized UI read-model cache (`.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`) exposing a snapshot with `lastEventSeq` cursor via `GET /api/agent-sessions/:provider/:providerSessionId`. Clients populate `@assistant-ui/react` before connecting to SSE, applying only events newer than the cursor to prevent duplicate events.
- **Real Tooling Execution Boundary:** Agent execution context integrates at the shared practical command execution boundary in `tools/specs.mjs`, avoiding fictitious command names and automatically binding `(provider, providerSessionId)` to `specId`/`taskId`.
- **Execution Modes & Permissions (Task 13):** Neutral execution modes (`ask`, `edit`, `agent`) cleanly map to provider CLI permission flags (`dontAsk`, `acceptEdits`, `bypassPermissions`), dynamic mode switching in UI and persistence in `.nevo-ai-local/bindings.json`, and unified interactive question interception.

## Evaluation Summary

### 1. Canonical Session Identity & Lifecycle Ownership
- **Finding:** Providers own AI session identity and lifecycle. Nevo identifies a session by `(provider, providerSessionId)` and stores local bindings.
- **Verification:** D2 clearly records this principle. No synthetic `nevoSessionId` or secondary state machine exists.

### 2. Claude Interaction Transport Decomposition
- **Finding:** `AskUserQuestion` is resolved via `PreToolUse/defer`, while native permission prompts remain open for Task 03 discovery.
- **Verification:** D5, `areas/claude-provider.md`, Task 03, and Task 05 cleanly separate the decided question deferral from the permissions mechanism comparison.

### 3. Thread History, Incremental Persistence & Reconnection Contract
- **Finding:** Concrete execution path established for thread restoration across page reloads and server restarts with `lastEventSeq` sequence matching the persisted thread state.
- **Verification:** Local normalized UI read-model cache serves `GET /api/agent-sessions/:provider/:providerSessionId` with `lastEventSeq`, populating `@assistant-ui/react` before live SSE stream connection with event deduplication.

### 4. Real Tooling Execution Path Integration
- **Finding:** Task 02 integrates at the real shared execution boundary of `tools/specs.mjs` for agent-driven workflows.
- **Verification:** Avoids fictitious command handlers and binds `(provider, providerSessionId)` to `specId`/`taskId` using `AgentExecutionContext`.

### 5. Execution Modes, Permissions & Unified Questions
- **Finding:** Task 13 defines provider-neutral modes (`ask` / `edit` / `agent`), persisting mode per session in `.nevo-ai-local/bindings.json` and injecting unified question capabilities for CLI providers.
- **Verification:** Declarations, allowed paths, and dependencies in Task 13 conform to decisions D1–D7 and constraints C1–C10.

---

# Review Checklist

- [x] No unresolved required fixes
- [x] No unresolved owner decisions (D1–D7 recorded and referenced)
- [x] No unresolved clarification requests
- [x] Semantic references in all 13 tasks resolve cleanly to constraints (C1–C10) and decisions (D1–D7)
- [x] Gating validations (`specs.mjs check`, `docs.mjs check`, `cli-smoke.test.mjs`) pass cleanly
- [x] Verdict: ready-for-approval

## Implementation Readiness

- May implementation start now? No — awaiting owner approval.
- Are the tasks `approved` in `change.yaml`? No — all 12 tasks are currently in `draft`.
- Next action: Owner reviews PR #29 and approves desired initial batch tasks (e.g. `provider-neutral-core-and-capabilities` through `claude-provider-adapter`) to unlock execution.
