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
spec_fingerprint: ec5703f81e9f1211982ab13a18296b36254817884789d2b66acbd658d9c038fd
task_fingerprints:
  provider-neutral-core-and-capabilities: b2ff7fba143263a7fec9de88e8f7d06b9f7210977e981aead8941845a25aab96
  session-binding-and-execution-context: 6cdbdeffda563e2fcf43ad2dd86aafbffc7b0e4488c4144d5639dcdd022f73ea
  claude-interaction-transport-discovery: 9f8f7f2e0ca06054b40221b3f6059587f50a7e67cfab2fc5015296536304a8e2
  claude-provider-adapter: f63ce4b11a0ef04a1d6aaebee6ebe566f6e25bf40b70a5e09021f6dc5433e7ff
  claude-interaction-and-deferral: 289d066bf82248d934edf153bd25ae98dd0b61cfafb860d2561cd52ac6334a17
  agent-session-http-sse-api: 538874743b20a3d14aa4def220facd2990fb906fdb7c6dabc1f4939e772c74fe
  assistant-ui-integration-and-adapter: 4435b9d25dec1d13521efcfe6d4a5dcb80d097b789f63d131f14c873ed3c5f08
  custom-renderers-and-interaction-ui: ba8791ef1727371c1d9c67de2882b31ac84e75717831c953190c7bcdf3af42ad
  dashboard-session-ux-and-spec-binding: b19dbc5842b30467f3ec4e8390689cf35f449cff5973a6bd172fb3f647afd2d4
  antigravity-adapter-and-events: 5268c448bc0d198a0bda08c61f7fdf7f1835adc00f544a3751c8512aae0ddc0e
  multi-provider-consistency-audit-and-refinement: 71ae5bedf4bfe6d0b37e80635dac9a49194088d146d882f20cb03f2c45a136c1
  final-verification-and-architecture-docs: 53fb293be94ee642f4183632beaedfee170350fc2d4f1b860d2b28fe29ffd747
  agent-execution-modes-and-permissions: f36bd1cbd5490df192e2df72d9de0ae63c18d3326ae5863bbfd09d093330644d
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification:
- **`AskUserQuestion` vs Native Permissions:** `AskUserQuestion` is definitively resolved as `PreToolUse/defer` roundtrip. Native Claude permission prompt transport remains unresolved until Task 03 discovery (`--permission-prompt-tool` vs `PreToolUse/defer` vs `canUseTool`).
- **Normalized UI Read-Model Cache & Reconnect:** Providers own conversation continuity. NEvo maintains a local normalized UI read-model cache (`.nevo-ai-local/transcripts/<provider>/<providerSessionId>.json`) exposing a snapshot with `lastEventSeq` cursor via `GET /api/agent-sessions/:provider/:providerSessionId`. Clients populate `@assistant-ui/react` before connecting to SSE, applying only events newer than the cursor to prevent duplicate events.
- **Real Tooling Execution Boundary:** Agent execution context integrates at the shared practical command execution boundary in `tools/specs.mjs`, avoiding fictitious command names and automatically binding `(provider, providerSessionId)` to `specId`/`taskId`.
- **Execution Modes & Permissions (Task 13):** Neutral execution modes (`ask`, `edit`, `agent`) map deterministically to provider CLI flags (`ask` -> `--permission-mode plan` / `--mode=plan`, `edit` -> `--permission-mode acceptEdits` / `--mode=accept-edits`, `agent` -> `--permission-mode bypassPermissions` / `--mode=default --dangerously-skip-permissions`). Default execution mode is strictly `edit` without implicit escalation to `agent`, `ask` behavioral guarantee is validated via offline fixture evidence, and mode preferences are persisted per-specification in `.nevo-ai-local/sessions/<specId>.json`.

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
- **Finding:** Task 13 defines provider-neutral modes (`ask` / `edit` / `agent`), defaulting to `edit` and validating `ask` behavioral guarantees offline without modifying source files.
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
