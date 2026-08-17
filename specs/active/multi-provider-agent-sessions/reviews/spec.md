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
spec_fingerprint: 26c3fa74909b032bef61f6bb89ef7dfed2da076666e11e8177c635d2fb16fb9b
task_fingerprints:
  provider-neutral-core-and-capabilities: e7ead9a02facea4be068e89b08b930732dcd7c24bd86a5799781ba9c42cd052e
  session-binding-and-execution-context: c2f01a74ae82aab08bf6e2c8652ba6ec7df28da243392d267c366c73da6f1d5c
  claude-interaction-transport-discovery: 6346e70b9e73d3238620edbb38acc859d3f42b07ab4c55b9c440d457f98e4b5d
  claude-provider-adapter: 39a42b79760d41529fe10b6bf843ec8168cb87e7eaa4b52974a40a99252327db
  claude-interaction-and-deferral: 096f5b8a945d8cdb385b4e51bb9b6055f0caf3c6d77a7af21e7748de474c4864
  agent-session-http-sse-api: dfe6a17ff31e5d4eb904623e82e6ca395d17ab68ac5d6c71602cdebc59f646c2
  assistant-ui-integration-and-adapter: 6c2f6a2058efe0ae6263fa87005a9c3dd94ec165b87b93ad686def979ecc3a6e
  custom-renderers-and-interaction-ui: 9a9cb0db4f54f1eb6e65f5911d9a42f94536c6e4c8e064d8437494894c096cca
  dashboard-session-ux-and-spec-binding: 2c9c454d592c86d5bdd9ad180d2c5e70313d314f81a2c38df89c3d570e96a07c
  antigravity-adapter-and-events: 76c82b60282ece80289666ff96a7f286651557c63056d9ec563952d198fe7137
  multi-provider-consistency-audit-and-refinement: f8460b2efd79f3068aece43bece8c2f409d37822353748a46b275046d0b9c510
  final-verification-and-architecture-docs: 0b3cb9d1d27ff6f2c439947a1a138546819eb8b684da4bdc77124bae542ab69b
---

# Specification Self-Review: multi-provider-agent-sessions

Comprehensive self-review of the refined `multi-provider-agent-sessions` specification following the architectural simplification: **Nevo does not own AI session lifecycles. Providers own their sessions; Nevo stores local provider-neutral bindings from specs and tasks to provider session identities `(provider, providerSessionId)` and uses adapters to interact with those sessions.**

## Evaluation Summary

### 1. Canonical Session Identity & Elimination of Synthetic Nevo Lifecycle
- **Finding:** All traces of `nevoSessionId` and `NEVO_AGENT_SESSION_ID` have been removed.
- **Verification:** Canonical identity is `AgentIdentity { provider, providerSessionId }`. The HTTP REST and SSE APIs use clean locators `/api/agent-sessions/:provider/:providerSessionId/...` without artificial wrapping.

### 2. Provider-Neutral Session Binding & Execution Context
- **Finding:** Session-to-spec/task binding is managed by the shared `AgentSessionBindingService` and `AgentExecutionContext` (Task 02) used across CLI commands (`agent-session attach`, `spec refine`, `spec review`, `task start`), provider hooks, and dashboard actions.
- **Verification:** Common resolver translates both human-readable slugs and immutable UUIDs into canonical `specId`. Many-to-one historical bindings are stored in `.nevo-ai-local/sessions.json` outside version control.

### 3. Provider Interaction Transport & Real CLI Semantics
- **Finding:** The spec strictly rejects unrealistic stdin/stdout bidirectional streaming within a single running process.
- **Verification:** Task 03 establishes a narrow discovery phase for `PreToolUse/defer` roundtrip (version check >= 2.1.89, fixtures, parallel tool call limitations, native permission mechanism selection). Task 05 explicitly implements resumption via `claude --resume <providerSessionId>` with `updatedInput`.

### 4. Capability Contract & Error Invariants
- **Finding:** Provider differences are represented through `AgentCapabilities`.
- **Verification:** Unambiguous contract: calling an unsupported capability throws a standard `CapabilityNotSupportedError`. `text.delta` is uniformly enforced across all adapters and events.

### 5. Task Scopes & Feasible Verification Boundaries
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
