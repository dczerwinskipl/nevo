---
id: deterministic-status-architecture.automatic-workflow-continuation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/continuation-service.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-step/**
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection ]
semantic_references:
  decisions: [D25, D26, D27]
---

# Task: Automatic workflow continuation

## Goal

Build the orchestration layer that observes a finish result plus the workflow definition's
`continueOnSuccess`/`sessionPolicy`/`role` (task 26's schema) and, without making
`finishStep()` itself session-aware, either creates/reuses the next step's session (D25/D26)
or auto-activates a human-owned step via the existing, unmodified `startHumanStep` (D27).

## Implementation constraints

- Investigate first where a finish result actually becomes observable to the dashboard for a
  dashboard-driven session (turn completion, per `agent-session-page.tsx`'s existing
  `onTurnCompleted` callback, which already refreshes the action projection) versus a
  CLI-only `workflow step finish` invocation the dashboard only learns about via its own
  polling/projection refresh — confirm which paths this task must cover, and document the
  finding before wiring the trigger, per this repository's own "confirm before designing"
  discipline (D6/D9/D13's own pattern).
- `continuation-service.mjs` (new): given a task's current workflow position and the matched
  transition's `continueOnSuccess`, decides `auto` vs. no-op. On `auto` + `executor: agent`
  for the next step: resolve the persisted execution policy (task 25) for the task/provider —
  if none resolved yet, do not auto-continue silently past a still-unresolved mode choice;
  surface it as if it were a first Start instead (never guess a mode on the user's behalf).
  Create or reuse a session per `sessionPolicy` (`reuse`: bind to the existing session id;
  `fresh`: create a new session recording `parentSessionId` = the prior session's id and
  `role` from the schema), then send the existing generic trigger message unchanged (D15).
  On `auto` + `executor: human`: call `startHumanStep` directly (D12's operation, unmodified)
  and surface the resulting interaction — no session created or bound.
- On `owner-action` (or absent `continueOnSuccess`): no-op — behavior identical to today
  (task remains `waiting-for-step-start`, manual "Start" required).
- Add `parentSessionId` and `role` fields to session identity in `binding-service.mjs`,
  following the exact shape convention already used for `activeTaskId`/`taskIds` (optional,
  present only when set) — do not change `listSessions`/`listSessionsSync`'s existing
  `taskId`-only filter semantics; these are new, additional fields, not a filter change.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code —
  every decision reads `continueOnSuccess`/`sessionPolicy`/`role`/`executor` from the
  definition, never a step-name comparison.

## Acceptance criteria

- A `standard-v1` task's `implementation → review` finish (with task 26's migrated
  `continueOnSuccess: auto`/`sessionPolicy: fresh`/`role: reviewer`) results in a new session
  with `parentSessionId` set to the implementer's session id and `role: reviewer`, with no
  manual "Start" click — proven end to end against a real (or realistically faked) finish
  result.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- The same task reaching `human-verification` (no `continueOnSuccess` migrated onto that
  step's own transitions unless task 26's audit added it) either continues automatically or
  stops, exactly matching whatever `continueOnSuccess` value that transition actually
  declares — never inferred from the step being named "human-verification."
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- A human-owned step reached via `continueOnSuccess: auto` is auto-activated
  (`startHumanStep` called by the orchestrator, not the user) and its real interaction is
  immediately visible — no intervening generic "Start" click.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- A transition without `continueOnSuccess: auto` leaves the task exactly as
  `waiting-for-step-start` today — no session created, no `startHumanStep` call.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- An agent-step auto-continuation for a task/provider with no resolved execution policy does
  not guess a mode — it surfaces the same selection requirement a first Start would.
  `automated: node --test tools/dashboard/tests/workflow-continuation.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id.

## Verification

```bash
node --test tools/dashboard/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 26). The
execution-policy selection UI (`execution-policy-and-mode-selection`, task 25). Dependency
release/invalidation (`dependency-release-and-invalidation`, task 28) — this task's
continuation logic does not itself decide dependency satisfaction. Batch/multi-task
scheduling (`deterministic-batch-orchestrator`, task 29).
