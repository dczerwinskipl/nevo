---
id: readiness-classification-split
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/agent-admission-and-activation-readiness.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - tools/specs/workflow/readiness-policy.mjs
    - tools/specs/workflow/operation-record.mjs
  optional:
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/finish-operation.mjs
allowed_paths:
  - tools/specs/workflow/readiness-policy.mjs
  - tools/tests/execution-readiness-policy.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/operation-record.mjs
  - src/**
depends_on:
  - shared-finish-operation-replayability-classifier
semantic_references:
  decisions: [D2]
  dependency_contracts: [shared-finish-operation-replayability-classifier]
---

# Task: Readiness classification split

## Dependencies

`shared-finish-operation-replayability-classifier` — imports its exported replayability
function; never reimplements the running/blocked/unknown distinction locally.

## Goal

Add a shared, single-source classification of `evaluateBaseExecutionReadiness`'s failure
codes into **admission-blocking** vs. **activation-only** (D2), exported from
`readiness-policy.mjs`, without changing any existing return value, throw behavior, or test
outcome for `evaluateBaseExecutionReadiness`/`evaluateExecutionReadiness`/
`assertExecutionReadiness`/`assertBaseExecutionReadiness` themselves. This task only adds
the classification primitive; nothing yet consumes it to change behavior (tasks 03–04 do).

`FINISH_OPERATION_UNRESOLVED` is **not** a single-bucket code (D2 amendment): the
classification must expose a semantic sub-decision — *is the persisted prior finish-operation
state proven deterministically replayable* — computed by calling task 01's shared
`isFinishOperationReplayable` (or equivalent) helper against the loaded prior-step record,
never by reimplementing a second running/blocked/unknown check locally. This is the same D2
rule `execution-settlement.mjs` (task 05) applies on the terminal-classification side, via
the identical shared helper — one semantic source of truth, two call sites.

## Acceptance criteria

- A new exported set/function (e.g. `ACTIVATION_ONLY_READINESS_CODES` or
  `isActivationOnlyBlocker(code, context)`) classifies `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`
  as unconditionally activation-only, and every other existing readiness failure code
  (`TASK_UNPUBLISHED`, `DEPENDENCY_UNSATISFIED`, `WORKFLOW_TERMINAL`, `TASK_SUSPENDED`, the
  executor-mismatch code(s), `TASK_BARRIERED`) as unconditionally admission-blocking.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- `FINISH_OPERATION_UNRESOLVED` classifies as activation-only exactly when task 01's shared
  `isFinishOperationReplayable` returns `true` for the loaded prior-step record, and as
  admission-blocking when it returns `false` — verified by a test that imports the same
  shared function the production code path uses, so the two can never drift apart.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- A static check (import inspection or equivalent) confirms `readiness-policy.mjs` imports
  the replayability function from `operation-record.mjs` rather than duplicating a
  running/blocked/unknown check inline. `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- Every existing test in `execution-readiness-policy.test.mjs` still passes unmodified —
  this task changes no observable behavior of the readiness functions themselves.
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`
- The classification is exhaustive: a test asserts every code returned by
  `evaluateBaseExecutionReadiness` anywhere in its own source is classified one way or the
  other (fails loudly if a new code is ever added without classifying it).
  `automated: node --test tools/tests/execution-readiness-policy.test.mjs`

## Verification

```bash
node --test tools/tests/execution-readiness-policy.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Changing `createSession`/`startTurn`/`evaluateTaskQueue` to actually use this
classification (task 03). Changing `assertCleanWorktreeForNewAttempt`/`step-context.mjs`.
Changing `finish-operation.mjs`'s own resumability/crash-reconciliation logic, or
`operation-record.mjs`'s replayability helper itself (task 01 owns both) — this task only
imports and consumes the shared classification. `execution-settlement.mjs`'s own
in-flight-finish-operation check now applies the identical shared rule via task 05 — no
longer a separate, unaddressed observation (resolved across tasks 01/05, see D2's amendment
in `owner-decisions.md`).
