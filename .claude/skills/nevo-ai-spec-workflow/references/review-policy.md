# Review policy

## Specification readiness criteria

A spec is ready for implementation when:
- every task intended to start next has `status: approved`,
- `depends_on` references resolve and are not cyclic (`node tools/specs.mjs validate`
  checks this mechanically — run it),
- `allowed_paths` / `forbidden_paths` are present and unambiguous for every task,
- acceptance criteria are testable (a build/test/behavior check can confirm them — not
  aspirational language),
- no owner decision needed for the next task is still open,
- documentation impact (architecture docs, ADRs) is identified, even if deferred.

## Implementation review criteria

Compare the diff against: the task's acceptance criteria, its area's requirements (if
any), change-wide constraints, applicable ADRs, and architecture documentation. Check
behavior, tests, documentation impact, breaking changes, unrelated edits, generated
artifacts (`*.generated.*` should only change via the generator commands), and
verification evidence (build/test output).

## Blocking versus non-blocking findings

- **Blocking**: scope violation (edits outside `allowed_paths` or touching
  `forbidden_paths`), missing acceptance-criteria coverage, missing tests for behavior
  change, undocumented breaking change, architecture/ADR conflict not called out.
- **Non-blocking**: style nits, suggestions for a follow-up, minor documentation
  polish that doesn't affect correctness.

## Architecture drift detection

If the diff changes behavior that `docs/architecture/` describes, and the same branch
does not update that document, this is a blocking finding — architecture docs must
track current behavior.

## Documentation drift detection

If `docs/index.generated.*` or `specs/*.generated.*` are stale relative to their sources
(`node tools/docs.mjs check` / `node tools/specs.mjs check` fail), this is a blocking
finding — flag it rather than regenerating silently unless the owner asked for fixes to
be applied.

## Status recommendations

Recommend a task status transition (e.g. "ready to mark `implemented`" or "should stay
`in-implementation` — tests missing for X"), but do not change status yourself. Status
changes go through `tools/specs.mjs complete` / `verify`, invoked by the owner or on
explicit instruction.

## Owner-only transitions

Marking a spec "approved," marking a task "verified," and archiving a change are owner
(or owner-instructed) actions. A review command states a recommendation; it does not
perform the transition.
