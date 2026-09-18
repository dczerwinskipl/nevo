# Area: Step-executor model

## Responsibility

Give every deterministic workflow step an explicit `executor: agent | human` property with
its own execution protocol, and enforce it as an invariant — replacing the literal
`'human-verification'` step-name coupling with a generic mechanism, distinct from the
existing `entryGates`/`exitGates` (`type: human`) confirmation mechanism.

## Current state

No step in any of the five workflow definitions (`.nevo-ai/workflows/*.yaml`) declares an
`executor`. The only place "this step needs a human" is expressed today is
`handleWorkflowVerifyHuman`'s hardcoded `targetStep === 'human-verification'` check
(`tools/specs/workflow/cli.mjs`) plus whichever step happens to carry an `entryGate`/
`exitGate` with `type: human`. Nothing prevents `workflow step start` from being called
against that (or any) step regardless of who is meant to execute it — `resolveWorkflowPosition`
resolves position purely from `(workflow_progress, definition)`, with no executor concept at
all. Transition metadata (D37) is currently `{ to }` only — no `action`/label/feedback
metadata exists.

## Requirements

**Schema (D6):**

- Add `executor: agent | human` to the step schema (`tools/specs/workflow/definitions/schema.mjs`),
  validated by `tools/specs.mjs validate`. Absent `executor` defaults to `agent` (smallest
  migration — only steps that are actually human-owned need the field set explicitly).
- Add minimal transition `action` metadata: `{ label, feedback?: { required: boolean } }`
  per transition — additive, optional, consumed only by the human-step projection (never by
  the engine's own transition-resolution logic, which stays generic: `value`/`result`, `to`,
  required input).
- Add a terminal-step `outcome: success | failure` field (D9) — a step with no outgoing
  `transitions` declares this; absent `outcome` on a terminal step is a validation error for
  any *newly authored* definition (no silent default), but the migration below sets it
  explicitly on all five existing definitions so this never surfaces as a migration gap.
- Migrate all five existing definitions: set `executor: human` on each definition's
  human-owned step (today's `human-verification`-named step or equivalent), add `action`
  metadata to that step's transitions (e.g. `pass`/`fail` → `Approve`/`Request changes`,
  the latter with `feedback: { required: true }`), and set `outcome: success` on each
  definition's successful terminal step (today's `verified`-equivalent) and `outcome:
  failure` on any other terminal step a definition defines.

**Enforced invariant:**

- `workflow step start` rejects a step with `executor: human` before any mutation, with a
  structured error (code `WORKFLOW_STEP_EXECUTOR_MISMATCH`, step id, executor, purpose,
  expected work, available results/transitions) worded so an agent stops instead of
  retrying a different lifecycle operation. `workflow step finish` gets the same guard for
  defense in depth (an agent should never reach `finish` for a human step, since it can
  never `start` one, but the guard must not rely on that alone).
- The human-decision operation (`workflow verify-human`, generalized by this area) rejects
  an `executor: agent` step the same way, symmetric error shape.
- One guard function implements both directions — not duplicated per call site. The same
  function is reused by the readiness policy (`areas/execution-readiness-and-session-bootstrap.md`)
  for session/execution bootstrap: an agent execution session must never be created to work
  on a human-owned active step.

## Constraints

- `entryGates`/`exitGates` (`type: human`) are unmodified and untouched by this area — they
  remain "another executor's step, blocked pending human confirmation," a distinct concept
  from "this step is executed by a human." Do not merge the two mechanisms or let one
  subsume the other's schema/behavior.
- The engine's own transition-resolution logic must not understand "owner-review,"
  "acceptance," "human-verification," or "Approve" specifically — those are definition/
  projection-level concepts, expressed only through `executor` and the generic `action`
  metadata.

## Interfaces and boundaries

Exposes: the `executor`/`action`/`outcome` schema fields (read by
`areas/deterministic-projection-and-human-step.md`), and the executor-guard function (used
by `workflow step start`/`finish`, the human-decision operation, and the readiness policy).

Consumed by: every other area that reads workflow definitions or needs to know who executes
a step.

## Area-specific acceptance criteria

- All five existing workflow definitions validate against the extended schema after
  migration, with their human-owned step(s) carrying `executor: human` and their successful
  terminal step carrying `outcome: success`.
- A step with no `executor` declared defaults to `agent` and behaves exactly as before this
  area (backward-compatible default).
- `workflow step start`/`workflow step finish` against a step with `executor: human` fails
  with the structured `WORKFLOW_STEP_EXECUTOR_MISMATCH` error, before any mutation.
- The human-decision operation against a step with `executor: agent` (or no `executor`,
  i.e. the default) fails with the same structured error shape, before any mutation.
- The engine's transition-resolution logic contains no reference to `'human-verification'`,
  `'owner-review'`, `'acceptance'`, or `'Approve'` as literal strings.

## Dependencies

None — this is a foundation area other projection/guard areas build on.

## Out of scope

Any change to `entryGates`/`exitGates`. A full multi-named-outcome or retry-semantics
terminal model (D9 — only one `outcome: success | failure` field is added). Any UI
rendering of this schema (owned by the projection/UI areas).
