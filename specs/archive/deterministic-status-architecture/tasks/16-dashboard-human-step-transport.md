---
id: deterministic-status-architecture.dashboard-human-step-transport
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/dashboard-server-actions-wiring.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/specs/human-step-transport.mjs
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/ui/features/**
  - tools/dashboard/ui/screens/**
  - src/**
depends_on: [ human-step-execution-operations, execution-readiness-policy ]
semantic_references:
  decisions: [D14, D17]
---

# Task: Dashboard human-step transport

## Goal

Add the one generic HTTP transport `HumanStepSurface` needs to reach
`startHumanStep`/`submitHumanStepResult` — `POST /api/specs/:slug/tasks/:taskId/workflow/human-step`
(plus the `:source/:slug` variant), body `{ action: 'start' } | { action: 'submit', result?,
feedback?, artifacts? }` — closing the gap where those two domain operations exist but no
browser-reachable route can call them (D14), and exposing the client-side call as one
neutral, feature-agnostic function in `shared/lib/`, not a hook owned by either consuming
feature (D17).

## Dependencies

`human-step-execution-operations` — this transport calls `startHumanStep`/
`submitHumanStepResult` directly. `execution-readiness-policy` — by the time this task
lands, those two operations are already readiness-gated internally; this transport adds no
readiness logic of its own.

## Implementation constraints

- New server module (e.g. `tools/dashboard/server/specs/human-step-transport.mjs`) exposing
  a function (e.g. `executeHumanStepAction({ slug, taskId, action, result, feedback,
  artifacts, activeDir, root })`) that validates `action` is `'start'`/`'submit'` and calls
  `startHumanStep`/`submitHumanStepResult` directly — never through
  `handleWorkflowVerifyHuman`, never mapping `result` to `'approve'`/`'request-changes'` or
  any other named decision.
- Deliberately a **separate module** from `tools/dashboard/server/specs/actions.mjs` (hence
  that file is in `forbidden_paths` here) — this avoids file-overlap with
  `dashboard-actions-lifecycle-split`'s independent split of `actions.mjs`'s *existing*
  mutation functions; the two tasks do not need to coordinate on the same file.
- New routes in `tools/dashboard/server/specs/routes.mjs`:
  `POST /api/specs/:slug/tasks/:taskId/workflow/human-step` and
  `POST /api/specs/:source/:slug/tasks/:taskId/workflow/human-step` (mirroring the existing
  `:source/:slug` pattern other routes in this file already use, including
  `rejectSource`/`ACTIVE_ONLY` gating). Route-level body validation is generic: `action` is
  one of the two literals, `result`/`feedback`/`artifacts` are passed through untyped-checked
  beyond basic JSON shape — legality against the active step's actual transitions is
  `submitHumanStepResult`'s job, never this route's.
- Error responses preserve structure: catch errors from `startHumanStep`/
  `submitHumanStepResult` (executor mismatch, readiness failure, invalid transition result,
  missing required feedback) and return them as JSON carrying at minimum `code`, plus
  whichever of `stepId`/`executor`/`allowedResults` the specific error type carries — never
  collapsed into a single generic `{error: string}` message the way the existing
  `executeHumanDecision` catch-all does.
- The existing `/workflow/human-decision` route, `handleHumanDecision`, and
  `executeHumanDecision` are **not** touched by this task — they remain exactly as they are.
- **D17 — the client-side transport is one neutral, feature-agnostic function, not a
  feature-owned hook.** `tools/dashboard/ui/features/agent-sessions/queries.ts` was the
  original (wrong) location — placing the only reusable transport there while
  `features/specifications` also needs it directly would make `TaskDialog` import
  `features/agent-sessions`, a sibling-feature import
  `tools/dashboard/tests/architecture-boundaries.test.mjs`'s test 1 forbids
  unconditionally. Instead, add `tools/dashboard/ui/shared/lib/human-step-request.ts`:
  a plain async function (e.g. `postHumanStepAction({ source?, slug, taskId, action,
  result, feedback, artifacts })`) wrapping the two POST shapes, no React, no query-cache
  concerns, no import from any `features/**`/`screens/**`/`routes/**`/`app/**` path (shared
  layer purity, `architecture-boundaries.test.mjs` test 2). This task builds and exports
  that function; it does not wire it into either feature or into `HumanStepSurface` itself
  — each feature's own thin adapter hook (`human-step-surface-consolidation`'s scope, which
  depends on this task) calls it independently.

## Acceptance criteria

- `POST .../workflow/human-step` with `{action: 'start'}` against a ready, correctly-
  executor-matched waiting human step succeeds, activates it, and creates no AI execution
  session. `automated: node --test tools/dashboard/tests/human-step-transport.test.mjs`
- `POST .../workflow/human-step` with `{action: 'submit', result, feedback}` against an
  active human step succeeds when `result` matches a declared transition, and when
  `feedback` satisfies that transition's `action.feedback.required`.
  `automated: node --test tools/dashboard/tests/human-step-transport.test.mjs`
- `POST .../workflow/human-step` with `{action: 'submit'}` and no `result` against a human
  step with a single unconditional transition succeeds — no fabricated `result` is passed
  through. `automated: node --test tools/dashboard/tests/human-step-transport.test.mjs`
- A request against an agent-owned step, a not-ready task, or a `result` not matching any
  declared transition, each fail with a structured JSON error body (`code` present, plus
  the relevant identifying fields) and an appropriate non-2xx status — not a generic
  `{error: string}`. `automated: node --test tools/dashboard/tests/human-step-transport.test.mjs`
- The route never maps `result` back to `'approve'`/`'request-changes'` and never calls
  `handleWorkflowVerifyHuman`. `inspection: confirm the transport module imports startHumanStep/submitHumanStepResult directly, not handleWorkflowVerifyHuman`
- The existing `/workflow/human-decision` route and `executeHumanDecision` are unchanged —
  regression test against existing fixtures.
  `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
- `tools/dashboard/ui/shared/lib/human-step-request.ts` imports nothing from
  `features/**`/`screens/**`/`routes/**`/`app/**` and is importable from both
  `features/specifications` and `features/agent-sessions` without triggering a
  sibling-feature or shared-layer-purity violation.
  `automated: node --test tools/dashboard/tests/architecture-boundaries.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/human-step-transport.test.mjs
node --test tools/dashboard/tests/specs-actions.test.mjs
node --test tools/dashboard/tests/architecture-boundaries.test.mjs
```

## Out of scope

Wiring the shared transport function into `HumanStepSurface` or into either feature's own
adapter hook (task `human-step-surface-consolidation`). Any change to `actions.mjs`'s
existing mutation functions (task `dashboard-actions-lifecycle-split`, independent file
scope). Any change to the legacy `/workflow/human-decision` route.
