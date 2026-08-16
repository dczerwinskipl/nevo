---
id: dashboard-loading-and-progress.dashboard-operation-progress-ui
status: draft
change: dashboard-loading-and-progress
depends_on: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/dashboard-operation-progress-ui.md
    - tools/dashboard/src/hooks/use-dashboard-data.ts
    - tools/dashboard/src/components/spec-actions.tsx
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/stage-progress.tsx
  optional:
    - tools/dashboard/src/lib/types.ts
allowed_paths:
  - tools/dashboard/src/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
  - tools/specs.mjs
semantic_references:
  decisions: [D2, D6, D9, D10]
  dependency_contracts: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
---

# Task: Dashboard operation-progress UI

## Goal

Render the `Operation`/`Steps` contract (snapshot + resumable SSE, task 04) consistently
wherever the dashboard triggers a gate/verify/acceptance action, replacing the current
boolean `executing` spinner with real step-by-step progress. The component's rendering
logic is generic across every operation kind's payload shape (tasks 05/06/08). Real,
not-mocked end-to-end verification is performed against reachable dashboard actions:
task approval (`approve` expanded in task 08 into a 5-step operation), task verification (`verify`),
and `finalize` (task 05). CLI-only kinds (standalone self-check, batch-review) are verified
via fixture/mock payloads (D9, D10).

## Dependencies

Depends on task 04 (transport/contract), task 05 (generic gates and progress transport), and
task 08 (`approve` multi-step operation as a safe, repeatable real-world operation for UI observation).

## Implementation constraints

- One shared component renders any `Operation`'s steps — no bespoke per-operation-kind
  UI branches.
- Loading/error/completion states are visually consistent; a failed step and the
  overall operation's failure are both visible and distinguishable.
- On reconnect (refresh, brief network drop) during an active operation, the UI
  recovers current progress via the snapshot route rather than resetting.
- Cancellation is out of scope for this change (owner correction, 2026-08-15) — do not
  add a cancel control or assume one exists.
- Degrade sensibly (e.g. a single implicit step) for any operation type that ever
  reports zero explicit steps, rather than crashing.
- `stage-progress.tsx`'s existing static per-stage task-count bars stay as they are —
  this task does not repurpose or remove them, only adds the new live-operation view
  alongside/instead of the current boolean spinner at each trigger point.

## Acceptance criteria

1. Triggering `finalize` (task 05) — the primary example of a long, dashboard-triggered
   gate/action flow (validate specs, validate docs, check PR/review state, build, test,
   finalize) — shows steps appearing/completing in near real time during a real run
   against a disposable/sandbox change created for this verification, never a real
   in-flight change, since `finalize` actually merges and archives.
   `inspection: manual run against a disposable sandbox change, observe step-by-step UI updates`
2. A deliberately failing phase of a dashboard-triggered operation (e.g. a `finalize` run,
   against the same disposable sandbox change, with a failing `dotnet test` phase) shows
   that step's failure and the operation's overall failure as both visibly distinguishable
   in the UI.
   `inspection: manual run against a disposable sandbox change, with a failing phase`
3. Refreshing the page mid-operation and returning shows current state, not a blank/
   reset view. `inspection: manual refresh during an active operation`
4. The same component renders for at least two different operation kinds (one real —
   the task-level gate re-check, acceptance, or `finalize` from task 05, the only kinds
   reachable via a real dashboard trigger; one a fixture/mock `Operation` payload of a
   different `type`, standing in for a CLI-only kind like task 06's, since neither this
   task's `depends_on` nor the dashboard's own action surface includes a way to trigger
   a task-06 kind for real) without kind-specific UI code paths.
   `inspection: confirm component props/usage are operation-kind-agnostic`. If a task-06
   kind is later wired as an actual dashboard action, re-verifying against it for real is
   a good follow-up check, not a requirement of this task's own acceptance criteria.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Any new operation kind not already listed in the change overview.
- Changing what any action does — only how its progress is shown.
