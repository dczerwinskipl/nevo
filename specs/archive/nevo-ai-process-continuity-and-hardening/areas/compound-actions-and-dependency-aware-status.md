# Area: Complete owner-facing compound actions and dependency-aware status

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35.
> Closes FU-002 and FU-004 (`follow-ups.yaml`, both `status: open` as of this pass).

## Responsibility

Own two related corrections to owner-facing command output, both instances of the same
underlying rule: **an owner-facing compound action completes the operation promised by
its label; a status report never contradicts what the actual start action would do.**
Also owns closing F5 (final pre-approval review): `docs/ai/task-execution-policy.md`
reconciled to distinguish standalone per-task operation, owner-authorized batch
operation, genuine owner-decision stops, and internal command boundaries that must never
manufacture an extra confirmation — assigned here because this area already owns the
owner-facing compound-action/dependency-aware behavior the doc must describe correctly.

1. `spec-approve`'s "Approve and start implementation" outcome performs the lifecycle
   transitions (`approve` → `start`) and then continues directly into implementation in
   the same turn — never ending with a "go run this next" handoff for the operation its
   own label promised.
2. `node tools/specs.mjs status` / `deriveStage`'s `ready-to-start` stage never reports
   an `approved` task as ready to start unless its dependencies are actually satisfied.

## Current state

**FU-002 / compound action.** `spec-approve.md`'s "Approve and start" section runs
`approve` then `start` in the same turn with no additional confirmation prompt on the
happy path (confirmed during discovery for this pass — the only confirmations in that
section gate specific `start`-failure recovery branches, not a generic
pre-implementation ask). But on a fully successful run, the command's own closing
template still sets `Next command` to `Implement, then /nevo-ai:task-review <change-id>
<task-id>` — the outcome authorizes and completes the lifecycle transitions, then hands
back a text instruction rather than itself continuing into implementation. This is the
gap FU-002 actually names, independent of whether an intermediate confirmation prompt is
also present: "Approve and start implementation" as a label promises the whole
operation, but the command only performs half of it (the transitions) and defers the
other half (the implementation) to a separate, owner-re-initiated step.

**FU-004 / dependency-aware status.** `deriveStage` (`tools/specs/lifecycle.mjs`) finds
the first task with `status === 'approved'` and unconditionally returns
`ready-to-start` — confirmed by direct inspection: this code path never calls
`depsSatisfied`/`isTaskReady`, the same predicate `handleStart` itself uses to decide
whether a `start` would actually succeed. Reproduced concretely on 2026-08-06: `status`
reported task 13 as `ready-to-start` while its dependency (task 12) was still
`in-implementation` — a real, confirmed contradiction between what `status` claims and
what `start` would actually do if the owner acted on it.

## Requirements

### A. Approve and start completes the promised operation

1. **After `approve` and `start` both succeed, the flow continues directly into
   implementation in the same turn — no further ask.** The compound action's own label
   ("Approve and start implementation") is the contract: every word in it is performed
   before the turn ends, not merely authorized.
2. **Never ends with `Implement, then ...` for a successful "approve and start"
   outcome.** That phrasing is correct only for a plain `Approve` outcome (requirement
   4) or for a `start` failure that stops the combined flow per D17's own existing rules
   (unsafe_manual, REC-06, REC-08, REC-09, not_retryable, a failed acceptance
   criterion) — never for the fully-successful compound path.
3. **Reuses the existing batch implementation loop** (`batch-execution-and-gating-review`,
   task 08) rather than inventing a second implementation-driving mechanism — "approve
   and start, then implement" for one task is the same controller loop a
   `named-subset`/single-task batch already drives; this area wires the compound
   action's post-`start` continuation into that existing loop instead of building a
   parallel one.
4. **Plain `Approve` (no start) still stops after approval, unmodified.** This area
   touches only the "approve and start" outcome's post-`start` behavior — the
   three-outcome/four-outcome menu shape, and every other outcome's behavior, are
   unchanged from D3/D14.
5. **The rule, stated generally, for every future compound action:** an owner-facing
   compound action completes the operation promised by its own label — if a label says
   "X and Y," the command performs both X and Y in the same turn on the success path,
   never X-then-a-textual-pointer-to-Y. A future compound action added to this workflow
   is checked against this rule the same way this area's own fix is.

### B. Dependency-aware status

6. **`deriveStage`'s `ready-to-start` stage uses the same dependency predicate `start`
   itself uses** (`depsSatisfied`/`isTaskReady`, task 01) before reporting any task as
   ready-to-start — never the first `approved` task unconditionally.
7. **An `approved` task with unmet dependencies is reported as blocked-on-dependencies,
   naming the specific unmet dependency task(s) and their current status** — not
   silently skipped, not reported as ready.
8. **`status` reports the actual next genuinely executable task or action** — if the
   first `approved` task's dependencies aren't satisfied, `status` looks further (an
   earlier task that *is* ready, or the blocking dependency's own next action) rather
   than stopping at the first `approved` task regardless of readiness.
9. **`status` output never contradicts what `start` would actually do.** This is the
   testable form of the bug: for any task `status` reports as `ready-to-start`,
   `depsSatisfied(task, change)` is true at the moment of the report — a fixed
   invariant, not a best-effort heuristic.

## Constraints

- Requirement 1-5 touch only the "approve and start" outcome's post-`start` behavior —
  `spec-approve`'s other three outcomes (plain approve, keep as draft, show report) are
  unchanged.
- Requirement 6-9 touch only `deriveStage`'s `ready-to-start` stage computation — every
  other stage (`in-progress`, `needs-pr`, etc.) is unchanged unless it has the same
  latent gap (checked, not assumed, as part of this area's acceptance criteria).
- Never reintroduce a second implementation-driving mechanism parallel to the batch
  controller loop (requirement 3) — one loop, reused, not duplicated.

## Interfaces and boundaries

Exposes: the completed "approve and start" continuation (requirements 1-3, consumed by
`spec-approve.md`), the general compound-action completion rule (requirement 5, a
process rule for any future command in this skill), and the dependency-aware
`ready-to-start` computation (requirements 6-9, consumed by `tools/specs.mjs status` and
every command that reads `deriveStage`'s output, including `task-next`).

Consumes: the batch controller loop (`batch-execution-and-gating-review`, task 08) for
requirement 3; `depsSatisfied`/`isTaskReady` (`state-and-fingerprint-semantics`, task
01) for requirement 6; D17's existing combined-transition stop-condition list
(`resume-and-continue-controller`, task 03/`conversational-approval-ergonomics`, task
04) for requirement 2's exception cases.

## Area-specific acceptance criteria

- A test proves a fully successful "approve and start" run ends having actually begun
  implementation in the same turn, with no `Implement, then ...` handoff text in its
  closing summary.
- A test proves plain `Approve` (no start) still stops after approval with its existing
  closing shape, unmodified.
- A test proves a `start` failure that D17 already classifies as a combined-flow stop
  condition (e.g. `unsafe_manual`, `REC-06`) still stops the compound action exactly as
  it does today — this area does not relax any existing stop condition.
- A test proves `deriveStage`'s `ready-to-start` stage never returns a task whose
  `depsSatisfied` is false — a fixture with an `approved` task depending on an
  `in-implementation` task must report the dependency task, not the approved one, as
  ready/next.
- A test proves `status`'s reported next action is consistent with what `start` would
  actually accept for that same task at that same moment (the "never contradicts"
  invariant, requirement 9), run across every `deriveStage` stage, not only
  `ready-to-start`.

## Dependencies

`conversational-approval-ergonomics` (task 04) — `spec-approve.md`'s existing
"approve and start" outcome (D3/D17), extended by requirements 1-5.
`resume-and-continue-controller` (task 03) — `deriveStage`, extended by requirements
6-9. `batch-execution-and-gating-review` (task 08) — the existing batch implementation
loop this area's compound-action fix reuses (requirement 3) rather than duplicating.

## Out of scope

- Any change to the four-outcome `spec-approve` menu shape itself, or to D3/D14's own
  approval semantics.
- Any change to D17's combined-transition stop-condition list — this area completes the
  success path only; every existing stop condition is preserved exactly.
- A general audit of every `deriveStage` stage for a similar gap beyond
  `ready-to-start` — flagged as a candidate follow-up if found during this area's own
  acceptance-criteria testing, not silently expanded into this area's scope.
