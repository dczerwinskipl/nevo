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
  decisions: [D2]
  dependency_contracts: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
---

# Task: Dashboard operation-progress UI

## Goal

Render the `Operation`/`Steps` contract (snapshot + resumable SSE, task 04) consistently
wherever the dashboard triggers a gate/verify/acceptance/test/audit action, replacing
the current boolean `executing` spinner with real step-by-step progress for every
operation kind wired in tasks 05/06.

## Dependencies

Depends on task 04 (transport/contract) and task 05 (at least one real, wired operation
kind to verify end-to-end against). Deliberately does **not** depend on task 06 — this
task can run in parallel with it, since AC4's second operation kind is a fixture/mock,
not a real task-06 wiring; the component's genericness must not require task 06 to
exist in order to be provable.

## Implementation constraints

- One shared component renders any `Operation`'s steps — no bespoke per-operation-kind
  UI branches.
- Loading/error/completion states are visually consistent; a failed step and the
  overall operation's failure are both visible and distinguishable.
- On reconnect (refresh, brief network drop) during an active operation, the UI
  recovers current progress via the snapshot route rather than resetting.
- Where cancellation exists, expose it and render the cancelled state distinctly from
  success/failure.
- Degrade sensibly (e.g. a single implicit step) for any operation type that ever
  reports zero explicit steps, rather than crashing.
- `stage-progress.tsx`'s existing static per-stage task-count bars stay as they are —
  this task does not repurpose or remove them, only adds the new live-operation view
  alongside/instead of the current boolean spinner at each trigger point.

## Acceptance criteria

1. Triggering self-check (task 05) shows steps appearing/completing in near real time
   during a real run. `inspection: manual run against a real task, observe step-by-step UI updates`
2. A deliberately failing verification command's step and the operation's overall
   failure are both visibly distinguishable in the UI.
   `inspection: manual run with a failing verification command`
3. Refreshing the page mid-operation and returning shows current state, not a blank/
   reset view. `inspection: manual refresh during an active operation`
4. The same component renders for at least two different operation kinds (one real, from
   task 05; one a fixture/mock `Operation` payload of a different `type`, since this
   task's `depends_on` does not include task 06 and must be independently verifiable
   without it) without kind-specific UI code paths. `inspection: confirm component
   props/usage are operation-kind-agnostic`. Once task 06 lands, re-verifying against a
   real task-06 operation kind is a good follow-up check, not a requirement of this
   task's own acceptance criteria.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Any new operation kind not already listed in the change overview.
- Changing what any action does — only how its progress is shown.
