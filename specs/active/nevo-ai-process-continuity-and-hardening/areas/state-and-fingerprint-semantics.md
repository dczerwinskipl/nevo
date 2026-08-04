# Area: State and fingerprint semantics

> Refined 2026-08-04 — see `owner-decisions.md` D7, D8. The area's boundary is unchanged;
> its content is significantly more specific than the original draft.

## Responsibility

Own the persisted state model of `change.yaml`: what a lifecycle status means, which
statuses satisfy a dependency, the `execution.suspension` schema (orthogonal to status),
and the three-tier semantic fingerprint model. This area is the foundation every other
area depends on.

## Current state

See `overview.md` § "Current architecture" for full citations. Summary: `TERMINAL_STATUSES`
treats `implemented`/`verified`/`archived`/`abandoned` identically for dependency
satisfaction (`lifecycle.mjs:11-17`); `superseded` is inert; `blocked`/`needs-decision`
are valid-but-unreachable and **stay that way** under this refinement (D8 reversed the
original plan to make them reachable); `computeSpecFingerprint` hashes whole files,
including `status` (`service.mjs:128-153`), which both causes the original confirmed
cross-task invalidation defect and, even after excluding `status` alone, still
over-invalidates under other operational-adjacent changes (D7).

## Requirements

1. **Fingerprint tiers (D7).** Replace `computeSpecFingerprint` with three functions:
   - `computeChangeFingerprint(change)` — a canonical projection over change scope,
     shared constraints, owner decisions, change-level acceptance criteria, the task
     graph's shape (ids + `depends_on` edges only, not per-task status), cross-task
     invariants, and shared context rules.
   - `computeTaskFingerprint(change, taskId)` — a canonical projection over that task's
     own definition, acceptance criteria, `allowed_paths`/`consequential_paths`/
     `forbidden_paths`, `context`, `context_exceptions` (D13, added by task 06 — this
     task only reserves the field in the projection), the subset of `depends_on` whose
     target's scope the task actually references, and any owner decision or shared
     constraint the task explicitly uses.
   - `computeImplementationFingerprint(change, taskId)` — the task-level fingerprint plus
     a reviewed diff/revision identifier and evidence references (populated by later
     tasks; this task only defines the function's contract).

   "Canonical projection" means: extract the specific semantic fields listed above from
   parsed YAML/Markdown structures and hash *that*, not raw file bytes — no exclusion
   list to maintain, because nothing operational is included in the first place.
2. Implement the invalidation matrix from `overview.md` § "Proposed architecture" →
   "State model" as the acceptance contract for requirement 1 — every row is a test case.
3. **`execution.suspension` (D8).** Add the optional, per-task
   `execution: { suspension: { kind, code, previous_action, created_at } }` structure to
   the schema. This task defines and validates the *shape* only — writing/clearing
   suspensions is area `recovery-and-resume`'s job (task 02). Both `status` and
   `execution.suspension` (when present) are excluded from all three fingerprint tiers.
4. `depsSatisfied` excludes `abandoned` from dependency-satisfying terminal statuses.
5. Resolve `superseded`: either give it real, non-dependency-satisfying terminal
   semantics, or remove it from `service.mjs`'s `STATUS_ORDER`. Do not leave it inert.
6. **Do not** add `blocked`/`needs-decision` as writable/reachable statuses — D8
   explicitly reversed this from the original draft. `TRANSITIONS`
   (`lifecycle.mjs:29-34`) is not modified by this task.

## Constraints

- No new lifecycle status names are introduced.
- `TRANSITIONS` keeps its existing four entries unchanged — this task's own analysis
  confirmed the refined state model does not require touching it (contrast with the
  original draft's "must no longer prohibit transition changes if genuinely required" —
  the genuine requirement turned out to be satisfiable without doing so).
- The three fingerprint functions must not read or hash `status` or
  `execution.suspension` under any circumstance — a test enforces this directly (change
  either field, assert the relevant fingerprint(s) are byte-identical).

## Interfaces and boundaries

Exposes: `computeChangeFingerprint`, `computeTaskFingerprint`,
`computeImplementationFingerprint`, the validated `execution.suspension` shape, an
updated `depsSatisfied`, and (if kept) defined `superseded` semantics.

Consumes: nothing new from other areas — this is the foundation.

## Area-specific acceptance criteria

- A test suite covers every row of the invalidation matrix in `overview.md`.
- A test proves `execution.suspension` never changes any fingerprint tier's output.
- A test proves a task depending on an `abandoned` task is excluded from `next`.
- `node tools/specs.mjs validate` passes with `superseded` either removed or fully
  defined.

## Dependencies

None — this is the first area implemented.

## Out of scope

- Writing or clearing `execution.suspension` values (area `recovery-and-resume`).
- `context_exceptions`' actual population (area `context-and-validation-hardening`) —
  this task only reserves the field in the task-level fingerprint's input set.
