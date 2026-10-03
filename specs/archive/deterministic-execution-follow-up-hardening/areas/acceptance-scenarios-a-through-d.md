# Area: Acceptance scenarios A through D

## Responsibility

Prove, at orchestration/E2E level (not unit tests of individual helpers), that the four
scenarios from the original problem statement behave as specified once Area A and Area B
land — including Scenario D, which requires no code change but does require an explicit
regression guard tied to this specification — plus D2's admission/settlement symmetry for
finish-operation replayability (spec-review correction), which spans both Scenario A's
admission side and Scenario B's resume side and is proven as its own regression rather than
folded into either.

## Current state

`workflow-continuation.test.mjs` and `workspace-writer.test.mjs` already cover Scenario D's
invariant (D65, AC409/D33) at the primitive level. No existing test exercises the full
Scenario A or Scenario B/C flow end-to-end through the actual admission/readiness/settlement
call chain this spec changes, and none exercises a finish-operation record surviving a
terminated execution and being replayed by a different one.

## Requirements

- Scenario A test: a task in `ready`/`waiting-for-step-start` state with a dirty worktree —
  drive it through the real route/admission path (not a direct unit call), assert a
  session/turn is created, assert the structured activation blocker is present, assert
  `workflow_progress` is untouched (attempt not activated), perform remediation (commit or
  clean the dirty files), retry `workflow step start`, assert activation now succeeds.
  **Abandoned-remediation variant (added 2026-09-30, spec-review F4):** same setup, but the
  turn ends *without* remediating successfully — assert the terminal classification is
  `resumable` (not `recovery-required`), the claim is released, `workflow_progress` remains
  unactivated, and a later execution can be admitted again, receive the same structured
  blocker, and eventually succeed once real remediation happens.
- Scenario B/C test: admit an execution, activate the step, mutate a file inside the task's
  allowed scope, end the turn without calling `workflow step finish` — assert `resumable`
  classification and claim release. Then, in one variant, admit a *new* execution for the
  same session (Scenario C) and in another variant a *different* session (Scenario B) for
  the same task — assert both: same `(step, attempt)` returned, no attempt increment, no
  re-activation side effects, no duplicate dependency consumption (for a
  `consumesDependencies: true` step), and that the resumed execution can call
  `workflow step finish` normally to complete the step.
- Scenario D regression test: with an execution's claim genuinely live (turn not yet
  terminal), a second `admitAgentExecution` for the same task must not return `admitted`
  and must not yield a second live claim — assert via the real admission path, not just the
  workspace-writer primitive, tying it explicitly to this spec's acceptance criteria
  (existing lower-level tests may already pass; this test exists so a future regression in
  Area A/B is caught at the same level those areas operate).
- Finish-operation-replay regression test (added, spec-review correction): agent X enters
  a durable finish operation, its turn terminates while the record is still provably
  replayable, terminal reconciliation classifies `resumable` (not `recovery-required`), the
  claim releases, agent Y is admitted and invokes the ordinary `workflow step finish`, which
  resumes X's record to completion with no duplicate transition, dependency consumption, or
  attempt increment. Negative counterpart: a non-replayable finish-operation record still
  classifies `recovery-required` and blocks ordinary writable admission.

## Constraints

Each test must exercise the real call chain (`admitAgentExecution` and friends), not mock
around the exact functions being changed — the whole point of this area is to catch
integration-level regressions the two areas' own unit tests cannot.

## Interfaces and boundaries

Consumes both Area A and Area B's outputs. Produces no runtime code — test files only.

## Area-specific acceptance criteria

Each task's acceptance criteria are the scenario's acceptance criteria from the original
problem statement, verbatim (see each task file).

## Dependencies

`acceptance-scenario-a` depends on Area A's tasks. `acceptance-scenario-b-and-c` and
`acceptance-scenario-d-regression` depend on Area B's `terminal-reconciliation-adopts-outcome`.
`acceptance-scenario-finish-operation-replay` depends on both Area A's
`non-fatal-admission-for-remediable-blockers` and Area B's
`terminal-reconciliation-adopts-outcome`/`dependency-consumption-idempotent-on-resume`,
since it exercises the admission and settlement sides together.

## Out of scope

Unit-level coverage of individual functions (already required within each Area A/B task's
own acceptance criteria).
