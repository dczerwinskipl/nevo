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
spec_fingerprint: 0daf09f706de147bba42b746373eaedff3c8fccaf0d951579250b9887e70e6ee
task_fingerprints:
  provider-neutral-core-and-capabilities: 695333c61a800e01c017cacea232e6ca5aaf0daab85230f0ec139bcda24d084c
  session-binding-and-execution-context: 8f03ab303f014ed3f31483b854cf03ed4bcfde30b7885d015a325960b2cdde2c
  claude-interaction-transport-discovery: 6f0f7879abd499ad77695d2e6841f737cb3291c50a3c3d673b815c747c4506bb
  claude-provider-adapter: 123bcac3be37e00a62f0174eff6f3bb1acb60220093b25d740b7c8f0dabb4f05
  claude-interaction-and-deferral: e3c40eaa13c11dde6b6c0f516891edea9f9e1319db503acd94c37ff834c9a1e8
  agent-session-http-sse-api: e3ad325ada0b35546b4f9ff55d561236050d614c0c14a6ce33532a378c8f49a2
  assistant-ui-integration-and-adapter: add592902a2f448cef693befc4ac43ca11c1b6abd87a97b9b6374573f8d1538f
  custom-renderers-and-interaction-ui: 40ac810c6ec95fd0f858478c669b8703002c996dd613d7670b21803009cbd2a4
  dashboard-session-ux-and-spec-binding: 77019e998b9938dfe48359b091dba468279e7f37b7d4130395ce5f1a2af5039b
  antigravity-adapter-and-events: 93035895cce7cfabd68987717655770a6a1b782006b776e904fbf1c917616f70
  multi-provider-consistency-audit-and-refinement: 5ee78735c9d0c2bcb1bafcef4a711748d2d62ce38d75d698eb05730b5b6606b7
  final-verification-and-architecture-docs: d3a5f67ab3419b12ac879a6ef2c9528568b8b88eb9a749123d3d2529d44b5aed
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification against repository invariants, architectural rules, and concrete execution viability.

## Evaluation Summary

### 1. Provider Interaction Transport & Real CLI Semantics
- **Finding:** The spec strictly rejects unrealistic stdin/stdout bidirectional streaming within a single running process.
- **Verification:** Task 03 establishes a narrow discovery phase for `PreToolUse/defer` roundtrip (version check >= 2.1.89, fixtures, parallel tool call limitations, native permission mechanism selection). Task 05 explicitly implements resumption via `claude --resume` with `updatedInput`.

### 2. Provider-Neutral Session Binding & Execution Context
- **Finding:** Session-to-spec/task binding is extracted into a shared `AgentSessionBindingService` and `AgentExecutionContext` (Task 02) rather than duplicated across CLI commands or dashboard routes.
- **Verification:** Common resolver translates both human-readable slugs and immutable UUIDs into canonical `specId`. Many-to-one history is preserved in `.nevo-ai-local/sessions.json` outside version control.

### 3. Capability Contract & Error Invariants
- **Finding:** Provider differences are represented through `AgentCapabilities`.
- **Verification:** Unambiguous contract: calling an unsupported capability throws a standard `CapabilityNotSupportedError`. `text.delta` is uniformly enforced across all adapters and events.

### 4. Task Scopes & Feasible Verification Boundaries
- **Finding:** Every task's declared `allowed_paths` directly matches its acceptance criteria and verification commands.
- **Verification:** Task 11 (`multi-provider-consistency-audit-and-refinement`) is equipped with permissions across `tools/ai/**`, `tools/dashboard/**`, and `tools/tests/**` to resolve any detected cross-layer drift, while Task 12 focuses on documentation and end-to-end repository checks.

### 5. Frontend Architecture & `@assistant-ui/react` Integration
- **Finding:** Frontend chat runtime is cleanly decoupled via `NevoAssistantRuntime` adapter.
- **Verification:** SSE reconnection, initial state snapshots, and interactive question forms are addressed. Peer dependencies verified against React 19.

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
