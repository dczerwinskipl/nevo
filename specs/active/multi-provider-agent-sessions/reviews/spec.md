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
spec_fingerprint: 4061cca7d8b5be77a8724d6d1f158aa7da63f711dee1e5076b9bfae9dc31dbc8
task_fingerprints:
  provider-neutral-core-and-capabilities: b6601fbe310b8688cd9ae1c6752e2b84687e4f826345c6fceca599dcbd589fc9
  session-binding-and-execution-context: 861f4cf85f14a834546aef9af76558d283a4be40d4bffde994764cfc4e60e057
  claude-interaction-transport-discovery: 6346e70b9e73d3238620edbb38acc859d3f42b07ab4c55b9c440d457f98e4b5d
  claude-provider-adapter: 0029935eb92a3ee89a36b9bc19d925322f31a9ae7b9686316befa0bb615bce24
  claude-interaction-and-deferral: 096f5b8a945d8cdb385b4e51bb9b6055f0caf3c6d77a7af21e7748de474c4864
  agent-session-http-sse-api: 0684801368c5008ec643e7ed3938263e2315fffbb2633d72d5e1de992044496d
  assistant-ui-integration-and-adapter: 6c2f6a2058efe0ae6263fa87005a9c3dd94ec165b87b93ad686def979ecc3a6e
  custom-renderers-and-interaction-ui: b5d7f72d5f85ae80e32be5ddb0e237be048c053fded423488430a7a86930f560
  dashboard-session-ux-and-spec-binding: 2c9c454d592c86d5bdd9ad180d2c5e70313d314f81a2c38df89c3d570e96a07c
  antigravity-adapter-and-events: c94fc2329e0128c9be0d862a14f1875061d0fe2f9d0bf3ac93aa2ba7accb11c7
  multi-provider-consistency-audit-and-refinement: 34561999ef32a1c32ca8e43bab1409ed7bd56f9fa278bf124fd2f0a74ccce46a
  final-verification-and-architecture-docs: a5f62224aff4793a29f5a34aeeab8d6064dd6a4f3e4376aa990f57e4e50d450d
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification following the architectural simplification: **Nevo does not own AI session lifecycles. Providers own their sessions; Nevo stores local provider-neutral bindings from specs and tasks to provider session identities `(provider, providerSessionId)` and uses adapters to interact with those sessions.**

## Evaluation Summary

### 1. Canonical Session Identity & Elimination of Synthetic Nevo Lifecycle
- **Finding:** All traces of `nevoSessionId` and `NEVO_AGENT_SESSION_ID` have been removed.
- **Verification:** Canonical identity is `AgentIdentity { provider, providerSessionId }`. D2 explicitly records: *Providers own AI session identity and lifecycle. Nevo identifies a session by `(provider, providerSessionId)` and stores only local bindings between provider sessions and specs/tasks.*

### 2. Provider-Neutral Session Binding & Execution Context
- **Finding:** Session-to-spec/task binding is managed by the shared `AgentSessionBindingService` and `AgentExecutionContext` (Task 02) used across CLI commands (`agent-session attach`, `spec refine`, `spec review`, `task start`), provider hooks, and dashboard actions.
- **Verification:** Common resolver translates both human-readable slugs and immutable UUIDs into canonical `specId`. Many-to-one historical bindings are stored in `.nevo-ai-local/sessions.json` outside version control.

### 3. Semantic References Consistency
- **Finding:** All 12 tasks reference valid, defined decisions (D1–D7) and constraints (C1–C10).
- **Verification:** Zero dangling semantic references detected across all task files.

### 4. Provider Interaction Transport & Real CLI Semantics
- **Finding:** The spec strictly rejects unrealistic stdin/stdout bidirectional streaming within a single running process.
- **Verification:** Task 03 establishes a narrow discovery phase for `PreToolUse/defer` roundtrip (version check >= 2.1.89, fixtures, parallel tool call limitations, native permission mechanism selection). Task 05 explicitly implements resumption via `claude --resume <providerSessionId>` with `updatedInput`.

### 5. Capability Contract & Error Invariants
- **Finding:** Provider differences are represented through `AgentCapabilities`.
- **Verification:** Unambiguous contract: calling an unsupported capability throws a standard `CapabilityNotSupportedError`. `text.delta` is uniformly enforced across all adapters and events.

### 6. Task Scopes & Feasible Verification Boundaries
- **Finding:** Every task's declared `allowed_paths` directly matches its acceptance criteria and verification commands.
- **Verification:** Task 11 (`multi-provider-consistency-audit-and-refinement`) is equipped with permissions across `tools/ai/**`, `tools/dashboard/**`, and `tools/tests/**` to resolve any detected cross-layer drift, while Task 12 focuses on documentation and end-to-end repository checks.

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
