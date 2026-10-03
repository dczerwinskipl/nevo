# Area: Terminal execution classification and attempt resumability

## Responsibility

Replace the binary `settled` result with a three-way classification —
`completed | resumable | recovery-required` — computed when a turn holding a workspace-writer
claim reaches its own confirmed-terminal boundary, so that any execution that ended safely
but left more legal work for the workflow — an active attempt left mid-work, a
pre-activation remediation attempt abandoned before it succeeded, or a
deterministically-replayable finish-operation record left behind — can be safely picked up
by the same or a different agent, without a new persistent claim status and without
double-activating, double-consuming dependencies, or masking genuinely ambiguous durable
state.

## Current state

`assessExecutionSettlement` (`tools/specs/workflow/execution-settlement.mjs:70-157`) checks,
in order: in-flight start-operation record, in-flight finish-operation record,
`workflow_progress.state === 'active'`, in-scope dirty files. Any failure →
`settled: false`, with no distinction between a genuinely ambiguous durable state and the
ordinary, expected state of an unfinished step — **and no distinction, for the
finish-operation check specifically, between a record proven safely replayable and one that
is genuinely ambiguous** (spec-review follow-up, D2's second amendment: this is the same
under-distinction `FINISH_OPERATION_UNRESOLVED` had on the admission side before D2's first
amendment, just on the settlement side of the identical record type). Three consumers
currently collapse all of this into the same binary decision:

- `admission.mjs`'s per-turn-terminal callback ("Hook 1", `admission.mjs:433-569`) — marks
  `recovery-required` on any `settled: false`, unconditionally.
- `reconciliation.mjs`'s boot-time reconciliation ("Hook 3", `reconciliation.mjs:219-448`)
  — same, for `'prepared'`/`'started'` claims found at boot. `'invoking'` claims skip
  settlement entirely and always fail closed to `recovery-required` (D99) — this must not
  change.
- `cli.mjs`'s `cli-manual` dead-pid takeover path (`cli.mjs:310-343`) also marks
  `recovery-required` on unsettled state before attempting a fresh acquisition.

Two adjacent, independently confirmed gaps must be closed as part of this area, because the
new resumability path makes them reachable in the ordinary course of use (not just edge
cases):

- **Dependency consumption is not idempotent across repeated activation of the same active
  step.** `cli.mjs`'s `consumesDependencies` block (`cli.mjs:379-447`) only skips
  re-planning when `findInFlightStartOperation` finds a record with status
  `running`/`blocked`/`reconciliation-required`. Once a record reaches `status: 'completed'`,
  a later `workflow step start` call for the *same, still-active* step/attempt takes the
  "no in-flight record" branch again, allocates a new `consumptionSequence`, and overwrites
  the dependency-consumption file again. `ensureStepActivated`'s own activation write is
  already correctly idempotent (no-ops for `phase === 'active'`) — this is a separate
  mechanism that is not.
- **Out-of-scope/forbidden dirty files are invisible to settlement.** `execution-settlement.mjs`
  only ever filters to `inScopeDirty`; nothing anywhere in the runtime path enforces or even
  surfaces a `forbidden_paths` violation (contrary to
  `docs/development/agent-workflow-protocol.md:88`'s "fails closed" claim — a pre-existing
  doc/code inconsistency). Resumability must not use `recovery-required` to paper over this
  (that reintroduces permanent blocking for ordinary work), but it must not stay silent
  either.

## Requirements

- Extend `assessExecutionSettlement`'s result with an explicit `outcome` field:
  - `'recovery-required'` — an in-flight **start**-operation record present (unconditional,
    unchanged), **or** an in-flight **finish**-operation record present that the shared
    `isFinishOperationReplayable` classifier (task 01) does not prove replayable
    (ambiguous/blocked/unknown). Handling unchanged (mark claim `recovery-required`).
  - `'resumable'` — no in-flight start-operation record, no non-replayable in-flight
    finish-operation record, **and** at least one of: (a) `workflow_progress.state ===
    'active'` (an attempt is genuinely mid-flight); (b) `workflow_progress.state !==
    'active'` but this execution never activated the attempt at all — a pre-activation
    precondition (D2) was still open when the turn ended, so nothing durable was ever
    advanced (broadened 2026-09-30, spec-review F1 — previously only sub-case (a) was
    `resumable` and sub-case (b) was miscategorized as `completed`, which hid it from
    continuation-skip logic that already treats it correctly, but also hid it from the
    audit trail and from Scenario A's acceptance coverage); or (c) an in-flight
    finish-operation record **is** present but proven deterministically replayable
    (spec-review follow-up, D2's second amendment — the identical rule the admission side
    already applies, via the same shared classifier, applied symmetrically here). In-scope
    dirty files never block this outcome in sub-cases (a)/(b) (expected WIP, or the same
    pre-existing activation blocker that will simply be re-reported, correctly, the next
    time activation is attempted); sub-case (c) has its own record-based signal and does not
    depend on the dirty-file check at all. Out-of-scope dirty files (if any) are attached to
    the result as a non-blocking diagnostic field, never escalating the outcome to
    `recovery-required`. Handling, identical for all three sub-cases: release the claim via
    the existing `releaseWorkspaceWriterIfOwned` (same primitive as `completed` uses today,
    not a new status write); `workflow_progress` is left completely untouched (a) or was
    never touched to begin with (b), and is untouched either way for (c); the durable
    finish-operation record itself is left completely intact for (c) — settlement only ever
    reads it; continuation is never triggered.
  - `'completed'` — no in-flight operation record, `workflow_progress.state !== 'active'`,
    and the attempt genuinely advanced during this execution (narrowed 2026-09-30,
    spec-review F1 — this is now the *only* thing `completed` means; the never-activated
    sub-case moved to `resumable` above). Existing behavior: in-scope dirty files after a
    real finish still block/flag exactly as today, continuation may run. Pick the smallest
    reliable signal for "did a real transition happen during this execution" (e.g.
    recording `step`/`attempt` at claim creation time on the in-memory/derived
    classification context, not on the persisted claim schema) and document the choice in
    the task.
- Update all three consumers (Hook 1, Hook 3, `cli-manual` takeover) to branch on `outcome`
  instead of the `settled` boolean. `turnStartState: 'invoking'` keeps its unconditional,
  settlement-bypassing fail-closed path to `recovery-required` — never routed through this
  new classification.
- Fix dependency-consumption idempotency: a `workflow step start` call for a step/attempt
  that already has a start-operation record (any terminal status, not only in-flight) for
  that exact `(step, attempt)` must complete only its unfinished stages, never re-plan a new
  `consumptionSequence` or re-record consumption.
- Emit the audit trail (D5): on `resumable` release, record an activity event (previous
  session/turn id, step, attempt, timestamp) via `tools/specs/activity/store.mjs`'s existing
  `recordActivity`; on the next admission for the same `(changeSlug, taskId, step, attempt)`
  while that release is the most recent unmatched activity for the key, record a second
  event (new session/turn id, timestamp) — using `actor-resolver.mjs` (already approved in
  `ai-spec-history`) for actor identity, not a new resolver.

## Constraints

- No new persisted field/value on the workspace-writer claim (D3).
- No explicit takeover acknowledgement of any kind (D4).
- Must not duplicate `ai-spec-history`'s `workflow-step-activity-producer` /
  `human-verification-activity-producer` scope — this area's activity events are a distinct
  kind (terminal-classification/resume), not step-start/finish producer events. Check those
  tasks' current file scope before editing shared activity call sites.
- Scenario D's mutex (worktree-scoped workspace-writer lock + spec-scoped
  `activeExecutions`) must remain untouched in shape — this area only changes what happens
  *after* a claim is confirmed terminal, never how concurrent acquisition is arbitrated.

## Interfaces and boundaries

Consumes: Area A's admission-blocking/activation-only classification, when distinguishing
"genuinely advanced" from "never activated" inside the `completed` outcome. Exposes: the
`outcome` field and its diagnostic payload to Area C's Scenario B/C acceptance tests.

## Area-specific acceptance criteria

- A turn ending with its task `active`, no in-flight operation record, produces `resumable`:
  claim released, `workflow_progress` byte-for-byte unchanged, no continuation fires.
- A turn ending with its task never activated by this execution (a pre-activation
  precondition was still open), no in-flight operation record, also produces `resumable` —
  not `completed` — claim released, `workflow_progress` untouched, no continuation fires.
- A turn ending with an in-flight **start**-operation record produces `recovery-required`,
  exactly as today (unconditional, unaffected by this area's finish-operation correction).
- A turn ending with an in-flight **finish**-operation record that is *not* proven
  replayable produces `recovery-required`, unchanged.
- A turn ending with an in-flight finish-operation record that *is* proven replayable
  produces `resumable`, not `recovery-required` — claim released, durable finish-operation
  record left intact, `workflow_progress` untouched (spec-review follow-up, D2's second
  amendment).
- A claim found at boot with `turnStartState: 'invoking'` always yields
  `recovery-required`, regardless of any settlement signal.
- Repeating `workflow step start` twice on the same active, dependency-consuming step
  records dependency consumption exactly once.
- Out-of-scope dirty files left after a `resumable` release are visible on the
  classification result and do not, by themselves, produce `recovery-required`.
- An activity event exists for a `resumable` release and, once a following execution
  resumes that same `(step, attempt)`, a second linked event exists.

## Dependencies

`three-outcome-terminal-classification` (task 05) depends on the shared
`shared-finish-operation-replayability-classifier` (task 01) — the same foundational task
Area A's `readiness-classification-split` consumes, per D2's second amendment. Task 05 is,
in turn, depended on by `terminal-reconciliation-adopts-outcome` (task 06),
`resume-and-terminal-audit-trail` (task 08), and the ADR task.
`dependency-consumption-idempotent-on-resume` (task 07) has no dependency of its own, but
`terminal-reconciliation-adopts-outcome` (task 06) now depends on it too (added 2026-09-30,
spec-review F3b): shipping resumability (task 06) before the dependency-consumption
idempotency fix (task 07) would turn a rare edge case into a routine double-consumption bug
the moment "call `workflow step start` again on an active attempt" becomes the normal way to
resume — so task 07 must land no later than task 06.

## Out of scope

- Broad runtime enforcement of `forbidden_paths` (only its visibility as a diagnostic is
  added here).
- Session/turn admission changes (Area A).
- Dashboard/UI surfaces for resume status.
- The same replayable-vs-ambiguous distinction for in-flight **start**-operation records —
  scoped to finish-operation records only in this pass (see task 05's Out of scope for the
  flagged, unaddressed observation).
