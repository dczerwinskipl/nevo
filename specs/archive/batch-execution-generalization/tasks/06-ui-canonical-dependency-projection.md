---
id: ui-canonical-dependency-projection
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/discovery.md
    - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  optional:
    - tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
  - tools/dashboard/tests/specification-overview-dependency-projection.test.tsx
forbidden_paths:
  - src/**
  - tools/specs/**
depends_on: []
---

# Task: Replace the UI's local dependency-satisfaction heuristic with the canonical projection

## Goal

Confirmed earlier this session (not re-derived): `specification-overview.tsx` has two
independent, inconsistent sources of truth for "is this dependency satisfied" —
`isSatisfied = depTask?.status === 'verified' || depGate?.state === 'terminal' || depGate?.terminalOutcome === 'success'`
(lines 98-101) and a separate initial-selection fallback
`gate?.state === 'ready' || gate?.canPublish || t.status === 'approved'` (lines 52-55)
— neither of which is the canonical `TaskProjection`/`ExecutionReadiness` the backend
actually uses to decide admission. The new batch/dependency picker this change's
other tasks enable needs correct, canonical dependency data — fix this now rather
than build new UX on top of the existing inconsistency and have to fix it twice.

## Requirements

- Replace both local heuristics with data sourced from the backend's own canonical
  projection/readiness for each task (whatever the dashboard API already exposes, or
  a minimal addition if it doesn't yet expose per-task `blockedBy`/`nextStep`/ready
  state in a form the picker can consume directly — check `taskActions`'s existing
  shape before adding anything new).
- The "ready task ids" pre-check (`readyTaskIds`, lines 47-61) and the
  cross-selection dependency warnings (`dependencyWarnings`, lines 89+) must both
  read from the same canonical source — no second, independently-evolving
  definition of "ready"/"satisfied" anywhere in this file.
- Preserve existing UI behavior for the currently-correct cases; the fix should
  change only the cases where the old heuristic and the canonical projection
  actually disagree (e.g. the exact bug reported: a task showing `READY` while also
  warning about an "unsatisfied" dependency that the canonical projection would
  recognize as already past the relevant checkpoint).

## Implementation constraints

- Do not invent a new backend endpoint/field if the dashboard's existing task-action
  projection already carries what's needed — check first.
- Do not change backend readiness/projection logic itself (forbidden path) — if the
  existing projection genuinely doesn't expose what the picker needs, stop and report
  back rather than extending backend code unreviewed under this task's scope.

## Acceptance criteria

- The exact previously-observed UI contradiction (`#06 READY` plus a warning that it
  depends on an "unsatisfied" `actor-resolver`) no longer occurs for the equivalent
  canonical state.
  `automated: npm --prefix tools/dashboard run test:ui-stable` (or a new dedicated
  test file for this component if none exists yet)
- `readyTaskIds` and `dependencyWarnings` are both derived from one shared helper/
  data source within the file — no duplicated satisfaction logic remains.
  `inspection: confirm a single canonical-readiness read path, not two`

## Verification

```bash
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Any backend readiness/projection change beyond what's already exposed. The batch
picker's own new multi-task-selection UX for implementation/refinement batches (not
yet speced as a UI task here — this task only fixes the existing duplication).
