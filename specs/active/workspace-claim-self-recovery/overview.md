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
- `activateAndSubmitHumanStep` creates a durable `human-submit` operation record
  (`status: 'pending'`) and a paired workspace request before it acquires the writer.
  When acquisition is blocked, the request moves to `blocked-by-recovery` but the
  operation record stays `pending`. A later identical decision hits `evaluateExistingOp`,
  which returns `{ ok: true, status: 'pending', idempotent: true }` without executing
  anything; the HTTP layer answers 200 and the UI treats that as success. Boot
  reconciliation only handles requests in `queued`, `waiting-for-workspace`, or
  `running`, so a `blocked-by-recovery` request is never revisited. This is what made the
  owner's approves silently do nothing even after the lock was released.
- No supported operator repair path exists; `forceReleaseWorkspaceWriterUnsafe` is
  internal/test-only.
- `assessExecutionSettlement` is already the shared classifier for settlement and
  reconciliation, and ADR-0009 explicitly rejects duplicating that logic.

## Problem

A settled agent claim can stay `recovery-required` indefinitely and blocks every human
action and every new admission until an unrelated dashboard restart. Nothing re-checks
it on demand, nothing tells the operator what holds the lock, and no supported repair
command exists.

Two further defects make the failure silent and sticky:

1. A human decision that failed to run leaves a `pending` operation record, so every
   retry is an idempotent no-op even after the lock is gone.
2. The dashboard shows no error: it treats HTTP 200 `status: 'pending'` as success, and
   (cause unconfirmed) did not render the blocked-by-recovery error either.
3. Starting an agent step (for example a review) from the task dialog also gave no
   feedback. The start error is stored in page-level state while the modal stays open on
   top. A blocked start may also leave durable pending state that blocks later attempts
   (to be confirmed by the verification cases).

## Constraints

- ADR-0009 (admission and execution ownership): fail-closed on genuine ambiguity; a
  single shared classifier; claim ownership checks stay conditional (`...IfOwned`).
- Never release a claim whose work is not provably settled.
- Contained to `tools/` and `docs/`; no `src/` changes.

## Affected modules

`tools/specs/workflow/` (workspace-writer, recovery module, human-step operations, CLI),
`tools/dashboard/server/specs/human-step-transport.mjs`, `tools/specs.mjs`,
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
4. The dashboard shows a failed human-step submit as a visible error, and does not treat
   `pending` as success.
5. ADR-0009 is amended and the protocol doc updated.
6. A stale `pending` human-submit operation is resumed (same decision) or superseded
   (different decision) instead of being returned as an idempotent no-op, and a blocked
   submit no longer leaves a `pending` record behind. The HTTP response states
   completed, in-progress, or failed explicitly (D4).

## Areas

Not split — one cohesive concern.

## Change-wide acceptance criteria

- A `recovery-required` agent claim whose task settles as `completed` or `resumable`
  never blocks `acquireWorkspaceWriter`; the claim is released and acquisition succeeds.
- A `recovery-required` claim whose settlement is genuinely ambiguous still blocks, and
  the error names the holding task and session.
- After a human decision is blocked and the cause is cleared, clicking the same decision
  again executes it. No retry returns success without executing.
- The existing workspace-writer, admission, reconciliation, and human-step test suites
  pass unchanged except for tests that assert the old unconditional block.

## Verification strategy

`node --test tools/tests/`, `node --test tools/dashboard/tests/` for the affected
suites, `node tools/specs.mjs validate`, `node tools/docs.mjs validate`.

### Verification cases

Task 07 turns the owner's two real failures into a standing regression suite: a blocked
human approve (VC1), a blocked single review start (VC2), a blocked batch review start
(VC3), a settled stale claim that must not block anything (VC4), and an in-progress
operation that must not report success (VC5). Each must be red on the pre-fix code.
The review-start failure of 2026-10-11 showed no feedback at all; the suspected cause
(error rendered at page level behind the task dialog) is unconfirmed and is reproduced
first.

## ADR impact

Amends ADR-0009 in place (D2); no new ADR.

## Out of scope

- The liveness-bound lease model (option 3).
- Changing when `reconcileHook1` fires, or making the per-turn hook re-subscribe.
- Changes to the activity history feature.
