---
id: spec.workspace-claim-self-recovery
type: change
title: Workspace claim self-recovery
status: draft
change: workspace-claim-self-recovery
---

# Workspace claim self-recovery

## Context

On 2026-10-11 the owner could not approve human-verification for two tasks of
`ai-spec-history`. The `workspace-writer` lock was held by an agent claim for a different
task (`activity-adr-and-docs`) in `recovery-required`, although that agent's work had long
been finished and settled. A temporary fix (running `reconcileBootState` by hand) released
it; this change removes the cause.

## Current architecture

Evidence from the repository:

- An agent claim is released only in the per-turn terminal hook
  (`tools/dashboard/server/ai/orchestration/admission.mjs`, `reconcileHook1`). The hook
  assesses settlement once, at the first terminal event, and unsubscribes immediately. A
  turn that ends with unsettled work (for example the model ran out of tokens) marks the
  claim `recovery-required`. Work completed in a later turn does not revisit the claim.
- The only other re-assessment is `reconcileBootState`
  (`tools/dashboard/server/ai/orchestration/reconciliation.mjs`), which runs once per
  dashboard process, lazily on the first `/api/ai/*` request.
- `acquireWorkspaceWriter` (`tools/specs/workflow/workspace-writer.mjs`) returns
  `blocked` unconditionally for a `recovery-required` claim. Liveness checks
  (`isProcessAlive`) apply only to request-backed claims (`human-submit`, `publish`,
  `batch-publish`), never to agent claims. The `pid` on a claim is the pid of the process
  that created it (the dashboard), so it says nothing about whether an agent is writing.
- `human-submit` surfaces the block as `WORKSPACE_WRITER_BLOCKED_BY_RECOVERY` with a
  message that does not name the holding task or session
  (`tools/specs/workflow/human-step/operations.mjs`).
- No supported operator repair path exists; `forceReleaseWorkspaceWriterUnsafe` is
  internal/test-only.
- `assessExecutionSettlement` is already the shared classifier for settlement and
  reconciliation, and ADR-0009 explicitly rejects duplicating that logic.

## Problem

A settled agent claim can stay `recovery-required` indefinitely and blocks every human
action and every new admission until an unrelated dashboard restart. Nothing re-checks
it on demand, nothing tells the operator what holds the lock, and no supported repair
command exists. Separately, the owner saw no error in the dashboard UI when the approve
was blocked.

## Constraints

- ADR-0009 (admission and execution ownership): fail-closed on genuine ambiguity; a
  single shared classifier; claim ownership checks stay conditional (`...IfOwned`).
- Never release a claim whose work is not provably settled.
- Contained to `tools/` and `docs/`; no `src/` changes.

## Affected modules

`tools/specs/workflow/` (workspace-writer, recovery module, CLI), `tools/specs.mjs`,
`tools/dashboard/ui/shared/` and `tools/dashboard/ui/features/specifications/` (error
visibility only), `docs/decisions/ADR-0009-...`, `docs/development/agent-workflow-protocol.md`.

## Options and trade-offs

See D1 in `owner-decisions.md`. Selected: option 2 (self-heal on contention + operator
command + diagnostics). Rejected: option 1 alone (leaves manual clicking after every
interrupted turn); option 3 (liveness-bound lease: removes the persisted state entirely
but re-models ADR-0009 and every claim producer).

## Owner decisions

D1 (recovery model), D2 (amend ADR-0009), D3 (separate change) — `owner-decisions.md`.

## Proposed architecture

1. A recovery module, `tools/specs/workflow/workspace-claim-recovery.mjs`, takes a
   `recovery-required` agent claim, runs `assessExecutionSettlement` for the claim's
   task, and returns a classified result: `released` (outcome `completed` with
   `settled`, or `resumable`) or `unresolved` (anything else, with the reason). Release
   goes through the existing `releaseWorkspaceWriterIfOwned`.
2. `acquireWorkspaceWriter` calls it when it meets an agent `recovery-required` claim,
   then retries acquisition once. If unresolved, it returns `blocked` as today, but the
   `currentClaim` carries the holder's task, change, and session, and the human-submit
   error message names them and the recovery command.
3. `node tools/specs.mjs workflow workspace recover` (name final in task 03) runs the
   same recovery module on demand and prints the outcome; it never force-releases an
   unresolved claim without an explicit flag.
4. The dashboard shows a failed human-step submit as a visible error.
5. ADR-0009 is amended and the protocol doc updated.

## Areas

Not split — one cohesive concern.

## Change-wide acceptance criteria

- A `recovery-required` agent claim whose task settles as `completed` or `resumable`
  never blocks `acquireWorkspaceWriter`; the claim is released and acquisition succeeds.
- A `recovery-required` claim whose settlement is genuinely ambiguous still blocks, and
  the error names the holding task and session.
- The existing workspace-writer, admission, reconciliation, and human-step test suites
  pass unchanged except for tests that assert the old unconditional block.

## Verification strategy

`node --test tools/tests/`, `node --test tools/dashboard/tests/` for the affected
suites, `node tools/specs.mjs validate`, `node tools/docs.mjs validate`.

## ADR impact

Amends ADR-0009 in place (D2); no new ADR.

## Out of scope

- The liveness-bound lease model (option 3).
- Changing when `reconcileHook1` fires, or making the per-turn hook re-subscribe.
- Changes to the activity history feature.
