---
review-of: spec
change: multi-provider-agent-sessions
generated: 2026-08-18
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: d82c00d42ada67c66d8b4571a7bb8fed6ddc0fcf37c0962ac6ca7131d100e88d
task_fingerprints:
  final-verification-and-architecture-docs: 0f089f0f5a4e9c87d06aa57fd97bc61e357532932bbb187542dd324195ae486c
  agent-execution-modes-and-permissions: ab03c48a157615786b3721f1f5ba969cf9ad403f0217e6535f719f0fbb7b42da
  turn-reliability-and-restart-resilience: d306c4bb039566dfda37d9cbee8352fa4d415ff22f2966f834ea250da3fe1aae
---

# Review: multi-provider-agent-sessions (scope: tasks 12-14)

## Verdict

`ready-for-approval` — the newly added task `turn-reliability-and-restart-resilience`
(order 14) has zero unresolved findings and a recorded owner decision (D8) with a real
two-option analysis for each of its two gated design choices; it is not yet `approved` in
`change.yaml`.

No reliable previous-file baseline was reused verbatim: the prior `reviews/spec.md`
(generated 2026-08-17) recorded fingerprints for tasks `final-verification-and-architecture-docs`
and `agent-execution-modes-and-permissions` that no longer match the current file
contents (implementation work on task 13 landed after that review without a follow-up
`/nevo-ai:spec-review`). Per the scoped-review guard, both were re-included in this run's
scope (`--tasks 12-14`) and freshly re-evaluated rather than trusted from the stale
baseline.

## Implementation readiness

- May implementation start now? No — `implementation_allowed: false`.
- Are the relevant tasks `approved` in `change.yaml`? No. `final-verification-and-architecture-docs`: `verified`. `agent-execution-modes-and-permissions`: `in-implementation` (unaffected by this review; already past its own approval gate). `turn-reliability-and-restart-resilience`: `draft`.
- What has to happen first? Nothing — ready. Owner approval of `turn-reliability-and-restart-resilience` via `/nevo-ai:spec-approve` is the only remaining step.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | resolved | `agent-execution-modes-and-permissions`'s requirement 4 ("Persist last-used `mode` per session in `AgentSessionBindingService`") is load-bearing on decision D6 (unified session binding service) | Task 13's `semantic_references.decisions` omitted `D6` despite depending on `AgentSessionBindingService` for mode persistence — unambiguous, so `AUTO_FIX`. Fixed in this pass: `decisions: [D1, D2, D3, D4, D5, D7]` → `[D1, D2, D3, D4, D5, D6, D7]`. | Read `tasks/13-agent-execution-modes-and-permissions.md` fresh this run; requirement 4 names `AgentSessionBindingService` explicitly, `semantic_references.decisions` did not include `D6` | `tasks/13-agent-execution-modes-and-permissions.md` |

No other findings. Task 14's `semantic_references` (`decisions: [D2, D7, D8]`, `constraints: [C2, C5, C8]`) are each load-bearing: D2 (providers own session lifecycle — the watchdog/reconciliation design introduces no new session lifecycle), D7 and C8 (normalized read-model cache / reconnect semantics — boot reconciliation writes into the same transcript cache and the system message it appends is read back through the same reconnect path), D8 (the owner decision this task implements), C2 (provider-neutral API — the list/detail status-parity fix), C5 (short-lived provider-owned processes — the watchdog cancels through the existing short-lived-process cancellation path, introducing no new process model). No missing or unnecessary reference.

Gating validation: passed (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`).
Non-gating repository check: passed (`node tools/specs.mjs check`, `node tools/docs.mjs check` — both current after regenerating `specs/index.generated.json` for the new task).

## Acceptance-criteria coverage *(new task only)*

- [x] `turn-reliability-and-restart-resilience`'s 4 requirements are testable as written: watchdog behavior, boot reconciliation, list/detail status parity, and error surfacing each name a concrete, checkable mechanism and an explicit verification command list.

## Architecture and documentation

`areas/provider-neutral-core.md` § 7 (new) documents the watchdog and boot-reconciliation
design ahead of implementation, consistent with D8. `owner-decisions.md` D8 records the
option analysis and decision. No ADR update is required at spec stage — `docs/decisions/ADR-0007-provider-neutral-ai-sessions.md` is in task 14's own `allowed_paths` if the
implementation later determines an ADR amendment is warranted.
