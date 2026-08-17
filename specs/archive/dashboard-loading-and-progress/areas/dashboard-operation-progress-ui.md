# Area: Dashboard operation-progress UI

## Responsibility

Render the `Operation`/`Steps` contract from `operation-progress-contract.md`
consistently everywhere the dashboard currently shows only a spinner/boolean for a
long-running action, with consistent loading/error/completion behavior across every
wired operation kind.

## Current state

- `useSpecificationActions` exposes only `executing: mutation.isPending`
  (`tools/dashboard/src/hooks/use-dashboard-data.ts:181`) — a single boolean consumed
  wherever gate/verify/finalize actions are triggered (`spec-actions.tsx`,
  `spec-detail.tsx`).
- `stage-progress.tsx` renders static task-count-per-stage bars, not live operation
  state — it is not reused or modified by this area beyond, if convenient, visually
  distinguishing it from the new live-operation view so users don't conflate the two.

## Requirements

- A new component (or extension of an existing one) renders an `Operation`'s steps: each
  step's label and status (done/running/pending/failed), and numeric progress
  (`current`/`total`) when the step provides it — matching the shape in
  `operation-progress-contract.md`, not a bespoke per-operation-type rendering. The
  component only ever consumes the dashboard backend's own parsed `Operation`
  snapshot/SSE payload — it never parses raw CLI stdout itself and never discovers or
  attaches to a CLI process the dashboard did not spawn (D9 in `owner-decisions.md`).
- The component is generic across every operation kind's *payload shape* (gate checks,
  spec verification, implementation/AI verification, task acceptance, batch
  verification, test runs, final audits) — no per-operation-kind bespoke UI. Real,
  not-mocked end-to-end verification is only possible for operation kinds actually
  reachable as a dashboard action today (the task-level gate re-check, task acceptance,
  and `finalize` — see D10 in `owner-decisions.md`); kinds with no dashboard trigger
  (e.g. `self-check` run standalone, `batch-review`) are proven kind-agnostic via a
  fixture/mock `Operation` payload instead, not a real trigger.
- Loading (operation running), error (a step or the operation failed — visibly
  distinguishable which), and completion states are handled consistently; a failed step
  is visibly a failure of that step, and the overall operation is visibly failed too
  (both signals present, not just one).
- On reconnect (page refresh, brief network drop) while an operation is active, the UI
  recovers and continues showing current progress rather than resetting to
  "not started"/showing nothing.
- Cancellation is out of scope for this change (per `operation-progress-contract.md`,
  owner correction 2026-08-15) — no cancel control is added; nothing here should assume
  one exists.

## Constraints

- Must not reconstruct step state from anything other than the events/snapshot the
  contract provides (no client-side guessing based on elapsed time).
- Keep the existing `executing` boolean behavior working for any action not yet
  emitting step events (should not apply after tasks 05/06 wire every listed kind, but
  the component must degrade sensibly — e.g. a single implicit step — rather than
  crash if an operation type ever reports zero steps).

## Interfaces and boundaries

- Consumes: the snapshot/SSE routes and event shapes (no cancel route) from
  `operation-progress-contract.md`.
- Exposes: the rendered progress view, integrated into `spec-actions.tsx`/
  `spec-detail.tsx` wherever a gate/verify/acceptance/test/audit action is triggered.

## Area-specific acceptance criteria

- Triggering an instrumented, dashboard-triggered action (the task-level gate re-check/
  acceptance, or — as the primary example — `finalize`, task 05) shows steps
  appearing/completing in near real time during a real (not mocked) run against a
  disposable/sandbox change created for this verification, never a real in-flight
  change, since `finalize` actually merges and archives. A second operation kind is
  proven kind-agnostic via a fixture/mock `Operation` payload of a different `type`,
  not a real trigger — task 06's kinds (batch-review, final audits) have no dashboard
  action to trigger them for real (D10 in `owner-decisions.md`).
- A step failure and an operation failure are both visible and distinguishable in the
  rendered UI for a deliberately-failing test fixture.
- Refreshing the page mid-operation and returning to the same view shows the operation's
  current state, not a blank/reset view.

## Dependencies

Depends on `operation-progress-contract.md` (transport/contract) and, for full
end-to-end verification, at least one CLI instrumentation task
(`tasks/05-cli-step-instrumentation-gate-and-verification.md`).

## Out of scope

- Any new operation kind not already listed in the change overview.
- Changing what any action does — only how its progress is shown.
