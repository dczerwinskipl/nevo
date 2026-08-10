---
id: nevo-ai-process-continuity-and-hardening.owner-workflow-acceptance-scenarios
status: draft
change: nevo-ai-process-continuity-and-hardening
depends_on:
  - review-report-minimization
  - deterministic-implementation-provenance
  - semantic-cross-task-integration-and-consolidated-decisions
  - scoped-and-incremental-spec-review
  - compound-actions-and-dependency-aware-status
  - unowned-drift-correction-flow
  - repository-bound-handler-testability
semantic_references:
  decisions: [D30, D33, D34, D35]
  constraints: [C1, C5]
  dependency_contracts:
    - review-report-minimization
    - deterministic-implementation-provenance
    - semantic-cross-task-integration-and-consolidated-decisions
    - scoped-and-incremental-spec-review
    - compound-actions-and-dependency-aware-status
    - unowned-drift-correction-flow
    - repository-bound-handler-testability
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/owner-workflow-acceptance.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
  optional:
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/14-review-report-minimization.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/15-deterministic-implementation-provenance.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/16-semantic-cross-task-integration-and-consolidated-decisions.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/17-scoped-and-incremental-spec-review.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/18-compound-actions-and-dependency-aware-status.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/19-unowned-drift-correction-flow.md
    - specs/active/nevo-ai-process-continuity-and-hardening/tasks/20-repository-bound-handler-testability.md
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
allowed_paths:
  - tools/tests/owner-workflow-acceptance.test.mjs
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
  - tools/specs.mjs
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
---

# Task: Owner-workflow acceptance scenarios

> New task, added 2026-08-06 (seventh refinement pass) — see `owner-decisions.md` D35.
> Final task in this refinement pass, depending on all seven others (14-20). Validates
> D34's ten-property bar across complete owner-facing flows.

## Goal

Validates D34's whole ten-property bar end-to-end, not just each individual mechanism
tasks 14-20 already unit-test. Adds the fifteen required regression scenarios from
`areas/owner-workflow-acceptance.md`, each exercising a real, owner-shaped command turn
composed from tasks 14-20's own mechanisms — never only an internal function call.

## Dependencies

Depends on all seven prior tasks in this refinement pass — every scenario exercises a
mechanism one or more of them owns:

- `review-report-minimization` (14) — scenarios 2, 3, 12.
- `deterministic-implementation-provenance` (15) — scenarios 8, 13.
- `semantic-cross-task-integration-and-consolidated-decisions` (16) — scenarios 4, 5, 6,
  7.
- `scoped-and-incremental-spec-review` (17) — scenario 9.
- `compound-actions-and-dependency-aware-status` (18) — scenarios 1, 10.
- `unowned-drift-correction-flow` (19) — scenario 11.
- `repository-bound-handler-testability` (20) — every scenario's own fixture-repo
  construction, so none of this task's tests mutates the real repository.

## Implementation constraints

- This task is test-only — `forbidden_paths` excludes every production source file
  (`tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`,
  `.claude/**`) precisely so a gap found here routes back to the owning task (14-20)
  for a real fix, never a workaround patched directly into this task's own scope.
- Every scenario is built using task 20's fixture-repo helper
  (`tools/tests/fixture-repo.test-helper.mjs`) — no scenario touches the real
  repository's `specs/`/`docs/` trees.
- Each scenario exercises a full command turn (the actual conversational/CLI flow a
  command file drives), not only the internal function the corresponding task already
  unit-tests — a scenario that only calls an internal function directly does not
  satisfy this task's own acceptance criteria, even if it exercises the same code path.
- Scenario 14 (aggregate reports cannot contradict canonical per-task reports) is
  regression coverage only, over `validateAggregateAgainstCanonicalReviews` (already
  shipped, commit `c000905`, before this refinement pass) — this task does not modify
  that mechanism.
- Scenario 15 (the composite "normal one-person batch" scenario) counts actual
  owner-facing turns in the fixture run and asserts the count matches exactly: one
  initial request, N genuine owner/scope decisions the fixture deliberately contains,
  and one final confirmation — no more.

## Acceptance criteria

1. Approve and start implementation begins work without another confirmation
   (`automated: node --test tools/tests/owner-workflow-acceptance.test.mjs`).
2. Passing review produces only minimal result rows — exactly the title plus three rows
   (acceptance criteria, scope, findings), with none of the four internal-only gates
   (verification, forbidden-path, docs, owner decision) rendered as its own row
   (corrected: proves the actual minimal shape, not only a line-count ceiling) (automated).
3. Failing review expands only failed checks (automated).
4. Multi-task review uses bounded per-task context (automated).
5. No owner questions appear between task reviews (automated).
6. Semantic integration detects a real contract mismatch (automated).
7. Path overlap alone does not create a defect (automated).
8. Two tasks modifying one shared file retain independent provenance (automated).
9. Scoped spec review evaluates a new task in old context without re-grading old tasks
   (automated).
10. Dependency-aware status never proposes an unstartable task (automated).
11. Legitimate unowned drift follows the named correction process (automated).
12. Accepted scope exceptions remain visible and narrow (automated).
13. Global HEAD advancement does not stale earlier evidence (automated).
14. Aggregate reports cannot contradict canonical per-task reports (automated,
    regression over the already-shipped `validateAggregateAgainstCanonicalReviews`).
15. A normal one-person batch requires only the initial request, genuine owner
    decisions, and one final review/status confirmation — the composite scenario
    asserts the exact count (automated).
16. No scenario in this task's own test file mutates the real repository's `specs/`/
    `docs/` trees — a guard assertion wraps every scenario (automated).
17. `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
    report clean after this task's doc edits (automated).
18. `node --test tools/tests/*.test.mjs` (the complete suite, tasks 01-21) passes
    (automated).

## Verification

```
node --test tools/tests/owner-workflow-acceptance.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

`docs/decisions/ADR-0006-process-continuity-and-hardening.md` (closing subsection for
the seventh refinement pass, naming task 21 as the pass's own acceptance gate; "Context"
paragraph names task 21 alongside tasks 01-20 as the change's current full task list).

## Out of scope

- Any production code change — this task is test-only (see `forbidden_paths`).
- Modifying `validateAggregateAgainstCanonicalReviews` or any other already-shipped
  mechanism from before this refinement pass.
- Reopening or rewriting tasks 01-20's own task/area files.
- A general audit of the workflow beyond the fifteen named scenarios — a gap found
  outside their scope is a candidate follow-up (`follow-ups.yaml`), not silently folded
  into this task.
