# Area: Repository-bound handler testability

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35.
> Closes FU-007 (`follow-ups.yaml`, `status: open`).

## Responsibility

Own parameterization of the repository/spec-root paths that `handleStart`
(`tools/specs.mjs`) and `checkSpecsIndexes`/`buildSpecsIndexes`
(`tools/specs/service.mjs`) currently read from module-level constants, so these
handlers can be driven end-to-end against a temporary fixture repository in a test,
without mutating the real checkout — while every production CLI invocation keeps its
current, unparameterized default behavior.

## Current state

FU-007 records this being worked around twice already in this change's own history,
neither a real fix: AC4 (task 02) extracted `handleStart`'s suspension-construction
decision into a pure, separately-tested function (`nextSuspensionForNotRetryable`) to
get *some* unit coverage without driving `handleStart` itself; REC-03 (task 10) wrote a
real test that corrupts and restores the *real* repository's generated indexes inside a
`finally` block — real coverage, but only by risking (briefly) the actual checkout's own
state. `handleStart` itself is confirmed (by direct inspection, unchanged since this
change's own reconciliation commit) still bound to `ACTIVE_DIR`/similar module-level
constants derived from `import.meta.url`, not a parameter.

## Requirements

1. **Parameterize repository/spec roots** for `handleStart`, `checkSpecsIndexes`, and
   `buildSpecsIndexes` — each accepts the root path(s) it operates against as an
   explicit parameter (or a small options object), rather than reading a module-level
   constant directly.
2. **Preserve production defaults.** Every real CLI invocation (`tools/specs.mjs`'s own
   entry point) continues to call these handlers with exactly the current, real
   repository paths as the default — no behavior change for any existing, non-test call
   site.
3. **Support temporary fixture repositories.** A test can construct a small, throwaway
   directory tree (a fixture `specs/active/<change>/...` structure) and drive
   `handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes` against it directly, with no
   risk to or dependency on the real repository's own `specs/`/`docs/` state.
4. **Coverage required, without mutating the real checkout:** `start` behavior
   (including the postcondition/suspension paths task 02 already built), index checks
   (`checkSpecsIndexes`), stale generated artifacts (the same REC-03 scenario task 10's
   existing test covers, now against a fixture instead of the real repo), recovery
   suspension paths (`execution.suspension` written/cleared correctly against a
   fixture), and `status`/task-selection (`deriveStage`/`task-next` against a fixture
   with a controlled task graph).
5. **No service locators, no global mutable configuration.** The parameterization is
   explicit function/constructor arguments (or a small, immutable options object passed
   through the call chain) — never a settable global, a singleton registry, or an
   environment-variable-driven override that could leak between tests or between a test
   run and a real invocation.
6. **Helpers stay small and composable.** The parameterized surface is the minimum
   needed for testability — a small set of focused functions/parameters, not a general
   dependency-injection framework or a rewrite of `tools/specs.mjs`'s overall structure.

## Constraints

- No production behavior change for any real, non-test invocation (requirement 2) — a
  hard rule, tested explicitly.
- No global mutable state introduced anywhere in `tools/specs.mjs`/
  `tools/specs/service.mjs` as part of this parameterization (requirement 5).
- Tests built against this area's new fixture support must never write to, delete from,
  or otherwise mutate the real repository's own `specs/`/`docs/` trees — the entire
  point of this area is removing that risk, not merely reducing it.

## Interfaces and boundaries

Exposes: the parameterized `handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes`
signatures (requirement 1), and a small, reusable fixture-repository test helper
(requirement 3) other tasks' future tests may also use.

Consumes: the existing `nextSuspensionForNotRetryable` extraction (task 02) and the
existing REC-03 real-repo-corrupting test (task 10) — both are superseded in *coverage*
by this area's fixture-backed equivalents but are not themselves required to be deleted
if they still provide value; superseding them is a task 20 implementation choice, not a
requirement of this area.

## Area-specific acceptance criteria

- A test proves `handleStart` driven against a fixture repository produces the same
  postcondition/suspension outcomes (`completed`/`safe_to_retry`/`partially_completed`/
  `not_retryable`/`unsafe_manual`) as the equivalent real-repo scenario, without
  touching the real repository at any point during the test run.
- A test proves `checkSpecsIndexes`/`buildSpecsIndexes` driven against a fixture with a
  deliberately stale generated index reports it as stale (the REC-03 scenario),
  reproduced without corrupting the real repository's own generated files.
- A test proves `execution.suspension` is written and cleared correctly against a
  fixture-driven `start` sequence.
- A test proves `status`/`deriveStage`/`task-next` produce correct output against a
  fixture with a controlled task graph (including a dependency-blocked task, exercising
  task 18's dependency-aware fix against a fixture rather than only unit-level mocks).
- A test proves every real CLI entry point still resolves to the actual repository's
  paths by default, unchanged — a regression test guarding requirement 2.
- Inspection confirms no new module-level mutable global or settable singleton was
  introduced anywhere in the touched files.

## Dependencies

`recovery-classification-and-machine-readable-errors` (task 02) — `handleStart`'s
existing postcondition/suspension contract and the `nextSuspensionForNotRetryable`
extraction this area builds fixture-backed coverage around.
`workflow-e2e-tests` (task 10) — the existing REC-03 real-repo-corrupting test this
area's fixture-backed equivalent supersedes in coverage.

## Out of scope

- A general dependency-injection framework or service-locator pattern (requirement 5,
  explicitly excluded).
- Rewriting `tools/specs.mjs`'s overall command-dispatch structure.
- Deleting the existing REC-03 real-repo test or the `nextSuspensionForNotRetryable`
  extraction as a hard requirement — superseding them in coverage is sufficient; removal
  is an implementation choice, not a mandate.
- Parameterizing every other handler in `tools/specs.mjs` beyond `handleStart`/
  `checkSpecsIndexes`/`buildSpecsIndexes` — scoped exactly to what FU-007 named.
