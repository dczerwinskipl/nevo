---
id: nevo-ai-process-continuity-and-hardening.repository-bound-handler-testability
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - recovery-classification-and-machine-readable-errors
  - workflow-e2e-tests
  - compound-actions-and-dependency-aware-status
semantic_references:
  decisions: [D8, D34, D35]
  constraints: [C1, C6]
  dependency_contracts:
    - recovery-classification-and-machine-readable-errors
    - workflow-e2e-tests
    - compound-actions-and-dependency-aware-status
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/handler-testability.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/compound-actions-and-dependency-aware-status.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
    - tools/specs.mjs
    - tools/specs/service.mjs
    - tools/specs/lifecycle.mjs
  optional:
    - tools/tests/start.test.mjs
    - tools/tests/e2e-workflow.test.mjs
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/service.mjs
  - tools/tests/fixture-repo.test-helper.mjs
  - tools/tests/handler-testability.test.mjs
  - specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml
  - docs/decisions/ADR-0006-process-continuity-and-hardening.md
consequential_paths:
  - docs/index.generated.md
  - docs/index.generated.json
  - specs/active.generated.md
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - examples/**
  - docs/development/**
  - docs/usage/**
  - docs/reference/**
  - specs/archive/**
  - AGENTS.md
  - CLAUDE.md
  - .claude/**
---

# Task: Repository-bound handler testability

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Closes `follow-ups.yaml` FU-007 (`status: open`).

## Goal

Closes D34 property 7 (deterministic evidence and lifecycle writes) by making the
evidence itself producible without risk to the real repository. Parameterizes
`handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes`'s repository/spec-root paths
exactly as specified in `areas/handler-testability.md`, preserving production defaults,
enabling fixture-backed end-to-end tests, without a service locator or global mutable
configuration.

## Dependencies

`recovery-classification-and-machine-readable-errors` (task 02) — `handleStart`'s
existing postcondition/suspension contract this task builds fixture-backed coverage
around.

`workflow-e2e-tests` (task 10) — the existing REC-03 real-repo-corrupting test this
task's fixture-backed equivalent supersedes in coverage.

`compound-actions-and-dependency-aware-status` (task 18) — AC4 exercises `deriveStage`'s
`ready-to-start`/dependency-blocked computation (task 18's own fix) against a fixture
task graph; this task cannot claim that coverage before task 18's `depsSatisfied` check
exists in `deriveStage`.

## Implementation constraints

- Change `handleStart`'s signature (`tools/specs.mjs`) to accept the repository root
  (or a small `{ activeDir, specsDir, ... }` options object) as a parameter, defaulting
  to the existing module-level constants when not supplied — every real call site
  continues to pass nothing extra and gets identical behavior.
- Apply the same parameterization to `checkSpecsIndexes`/`buildSpecsIndexes`
  (`tools/specs/service.mjs`).
- Add `tools/tests/fixture-repo.test-helper.mjs` — a small, reusable helper that
  constructs a throwaway directory tree (a minimal `specs/active/<change>/...`
  structure, with `change.yaml`, task files, and generated-index stand-ins) in a
  temporary location, and tears it down after use. No test using this helper touches
  the real repository's `specs/`/`docs/` trees.
- Do not introduce a settable global, singleton registry, or environment-variable-based
  override anywhere in `tools/specs.mjs`/`tools/specs/service.mjs` (area requirement 5)
  — parameters/options objects only.
- Keep the parameterized surface minimal — exactly the three named handlers, no broader
  refactor of `tools/specs.mjs`'s dispatch structure.
- Superseding the existing REC-03 real-repo test (task 10) or the
  `nextSuspensionForNotRetryable` extraction (task 02) in *coverage* is expected; neither
  file is required to be deleted as part of this task.

## Acceptance criteria

1. `handleStart` driven against a fixture repository produces the same
   postcondition/suspension outcomes as the equivalent real-repo scenario, without
   touching the real repository at any point during the test run
   (`automated: node --test tools/tests/handler-testability.test.mjs`).
2. `checkSpecsIndexes`/`buildSpecsIndexes` driven against a fixture with a deliberately
   stale generated index reports it as stale (the REC-03 scenario), reproduced without
   corrupting the real repository's own generated files (automated).
3. `execution.suspension` is written and cleared correctly against a fixture-driven
   `start` sequence (automated).
4. `status`/`deriveStage`/`task-next` produce correct output against a fixture with a
   controlled task graph, including a dependency-blocked task exercising task 18's
   dependency-aware fix against a fixture (automated).
5. Every real CLI entry point still resolves to the actual repository's paths by
   default, unchanged — a regression test guarding this explicitly (automated).
6. No new module-level mutable global or settable singleton exists anywhere in
   `tools/specs.mjs`/`tools/specs/service.mjs` after this task (inspection).
7. `follow-ups.yaml`'s FU-007 entry is updated to `status: resolved` with a
   `resolution` field referencing this task, only after AC1-AC6 and AC10 pass
   (`inspection`; resolution text names `handleSelfCheck` explicitly alongside the
   original three handlers, per D39).
8. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
   report clean after this task's changes (automated).
9. `node --test tools/tests/*.test.mjs` (full suite, including the new fixture helper
   and `handler-testability.test.mjs`) passes (automated).
10. `handleSelfCheck` (`tools/specs.mjs`) accepts the same `{ activeDir, gitRoot }`
    parameterization pattern as `handleStart`, defaulting to the real repository, and is
    driven end-to-end against a fixture repository — writing both `self_check` and a
    refreshed `implementation.changed_paths` without touching the real repository
    (`automated: node --test tools/tests/handler-testability.test.mjs`; D39, amended
    2026-08-08).

## Verification

```
node --test tools/tests/handler-testability.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (new subsection covering
why repository-bound handlers needed explicit parameterization instead of a service
locator or global override; "Context" paragraph names task 20 alongside tasks 01-19).

## Out of scope

- A general dependency-injection framework or service-locator pattern.
- Rewriting `tools/specs.mjs`'s overall command-dispatch structure.
- Deleting the existing REC-03 real-repo test or the `nextSuspensionForNotRetryable`
  extraction.
- Parameterizing any handler beyond `handleStart`/`checkSpecsIndexes`/
  `buildSpecsIndexes`/`handleSelfCheck` (AC10, D39).

> **Amended 2026-08-08 — owner-decisions.md D39.** The cross-task integration pass of
> `/nevo-ai:implementation-review --tasks 14-21` found `handleSelfCheck` still hardcoded
> the real repository's `ROOT`, even though `follow-ups.yaml`'s own FU-007 reason text
> already named "handleStart, index checks, **and similar handlers**" as the intended
> scope, and FU-007 was marked `resolved` by this task anyway. Task 15
> (`deterministic-implementation-provenance`) added new repo-root-dependent
> provenance-refresh logic to exactly this unparameterized function in the same change,
> making the gap concretely worse. D39 decided to extend this task's own
> `gitRoot`/`activeDir` parameterization pattern to `handleSelfCheck` rather than route it
> through a separate corrective task, since the target file (`tools/specs.mjs`) and test
> file (`tools/tests/handler-testability.test.mjs`) were already inside this task's own
> `allowed_paths`. AC10 below and this note are the resulting scope amendment.
