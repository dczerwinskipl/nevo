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
spec_fingerprint: 632b747f4ece6552d1dc3927bc14ba3f83734ba047370e10165f447a93fafd54
task_fingerprints:
  provider-neutral-core-and-capabilities: f1243477ab2ddef721d56eee35992cf17dea4fc091b47121e63304f292dc70d0
  session-binding-and-execution-context: c4de81d3f56d5b83433665759d01a2dcdf0b1f5faca49500a3765c401572b304
  claude-interaction-transport-discovery: 123201d8fd5d58d25f2effe63718a55a64916aedf45eb7f540d11816e22b8527
  claude-provider-adapter: 04aaba0ba1f10af7b36ba96c6c765daa530fdbe2297dc78c0fba05cb01fd45ba
  claude-interaction-and-deferral: a563ffe6a028a9cc6635859990afc589b3447ee85995d5c5d96f6da183fa8349
  agent-session-http-sse-api: f5e20ada292bfdfc62858de684f125b948021b90c673ff38d5168b6a602b8633
  assistant-ui-integration-and-adapter: 6319e2077110ce0e0f1f7f2c6fbab3cf6b1c1a53899a7f6c46e7bc378c41d37c
  custom-renderers-and-interaction-ui: 579ea72d2d99151adc2d93d72d3f1505ac035d316d477df49c70382a946d2a96
  dashboard-session-ux-and-spec-binding: 4f657080a956f5316d3c71c4fdec3f2e4776e2987e4b1a4f6c6348c867f79485
  antigravity-adapter-and-events: c94fc2329e0128c9be0d862a14f1875061d0fe2f9d0bf3ac93aa2ba7accb11c7
  multi-provider-consistency-audit-and-refinement: 34561999ef32a1c32ca8e43bab1409ed7bd56f9fa278bf124fd2f0a74ccce46a
  final-verification-and-architecture-docs: 0f786291aa36e1f904d2a35ee1c37a07a07f4eb45422621147067254ce75cbcf
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification following the architectural re-review:
- `AskUserQuestion` is decided as `PreToolUse/defer` roundtrip; native permissions mechanism is discovered and selected in Task 03.
- Page reload thread restoration and reconnect semantics are grounded in a local normalized UI read-model cache (`.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`) and `/history` API without creating a synthetic Nevo session lifecycle.
- Agent execution context and auto-binding integrate into the real shared command execution boundary of `tools/specs.mjs`.

## Evaluation Summary

### 1. Canonical Session Identity & Lifecycle Ownership
- **Finding:** Providers own AI session identity and lifecycle. Nevo identifies a session by `(provider, providerSessionId)` and stores local bindings.
- **Verification:** D2 clearly records this principle. No synthetic `nevoSessionId` or secondary state machine exists.

### 2. Claude Interaction Transport Decomposition
- **Finding:** `AskUserQuestion` is resolved via `PreToolUse/defer`, while native permission prompts remain open for Task 03 discovery.
- **Verification:** D5, `areas/claude-provider.md`, Task 03, and Task 05 cleanly separate the decided question deferral from the permissions mechanism comparison (`--permission-prompt-tool`, `PreToolUse/defer`, `canUseTool`).

### 3. Thread History & Reconnection Contract
- **Finding:** Concrete execution path established for thread restoration across page reloads without state loss.
- **Verification:** Local normalized UI read-model cache under `.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json` serves `GET /api/agent-sessions/:provider/:providerSessionId/history`, populating `@assistant-ui/react` before live SSE stream connection with event deduplication.

### 4. Real Tooling Execution Path Integration
- **Finding:** Task 02 integrates at the real shared execution boundary of `tools/specs.mjs` for agent-driven workflows.
- **Verification:** Avoids fictitious command handlers and binds `(provider, providerSessionId)` to `specId`/`taskId` using `AgentExecutionContext`.

---

# Review Checklist

- [x] No unresolved required fixes
- [x] No unresolved owner decisions (D1–D7 recorded and referenced)
- [x] No unresolved clarification requests
- [x] Semantic references in all 12 tasks resolve cleanly to constraints (C1–C10) and decisions (D1–D7)
- [x] Gating validations (`specs.mjs check`, `docs.mjs check`, `cli-smoke.test.mjs`) pass cleanly
- [x] Verdict: ready-for-approval

## Implementation Readiness

- May implementation start now? No — awaiting owner approval.
- Are the tasks `approved` in `change.yaml`? No — all 12 tasks are currently in `draft`.
- Next action: Owner reviews PR #29 and approves desired initial batch tasks (e.g. `provider-neutral-core-and-capabilities` through `claude-provider-adapter`) to unlock execution.
