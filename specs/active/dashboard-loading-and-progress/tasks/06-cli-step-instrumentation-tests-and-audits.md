---
id: dashboard-loading-and-progress.cli-step-instrumentation-tests-and-audits
status: draft
change: dashboard-loading-and-progress
depends_on: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/operation-progress-contract.md
    - tools/specs.mjs
    - tools/lib/operation-progress.mjs
  optional:
    - tools/specs/service.mjs
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/**
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D2, D7, D9, D10]
  constraints: [C1]
  dependency_contracts: [operation-progress-contract-and-transport, cli-step-instrumentation-gate-and-verification]
---

# Task: CLI step instrumentation — batch verification, test runs, and audits

## Goal

Emit `Operation`/`Steps` events (via the helper from task 04) for batch verification
(`handleBatchStatus`/`handleBatchReview` in `tools/specs.mjs`) and, if a genuinely
CLI-subprocess-driven "final audit" or "AI verification" operation exists as a
multi-step `specs.mjs`/CLI command, instrument it the same way.

Every kind instrumented here is **CLI-only** in this change (D9 in
`owner-decisions.md`): no dashboard `POST` route triggers batch-review, and per this
task's own Implementation constraints, "final audit"/"AI verification" may not even be a
CLI-subprocess operation at all. Instrumenting these still gives an agent/user running
them directly from the CLI the same shared structured stdout other commands emit — it
does not make them Dashboard Operations (no `operationId`/snapshot/SSE is created for
them here). Task 07's UI acceptance criteria accordingly do not require a real dashboard
trigger for any kind wired in this task (D10) — only a fixture/mock payload.

## Dependencies

Depends on task 04 for the contract/helper/transport to emit into, and on task 05 —
both tasks modify `tools/specs.mjs`, so they must not be implemented in parallel on the
same central file; the chain is 04 → 05 → 06.

## Implementation constraints

- Batch verification: `handleBatchReview` (and `handleBatchStatus` if it performs
  per-task work worth surfacing rather than a pure read) processes multiple tasks —
  represent each task's review as one step in the batch operation.
- Before instrumenting "final audits"/"AI verification"/"test runs" as separate steps,
  confirm during this task whether each is actually a distinct CLI-subprocess operation
  in `tools/specs.mjs`/`tools/specs/*` or is instead agent-orchestrated (a
  `/nevo-ai:spec-audit`/`/nevo-ai:task-review` conversational pass with no long-running
  subprocess the dashboard triggers). If a listed kind has no corresponding
  CLI-subprocess operation the dashboard actually invokes, do not fabricate one —
  record that finding in this task's own notes/PR description instead (per the
  constraint in `operation-progress-contract.md`: never invent artificial steps that
  don't exist).
- "Test runs" as their own concept may already be covered by task 05's self-check
  instrumentation (each verification command, including `dotnet test`/`npm test`
  invocations, is already a step there) — do not duplicate that work; only add
  something here if a genuinely separate test-run trigger exists outside self-check.

## Acceptance criteria

1. Running batch review emits one step per task processed, ending in
   `operation.completed`/`operation.failed` matching the batch's actual outcome.
   `automated: node --test tools/tests/*.test.mjs`
2. For any operation kind from the change overview's list that turns out not to be a
   CLI-subprocess operation, this task's output explicitly states that finding rather
   than silently instrumenting nothing with no explanation. `inspection: confirm task notes/PR description name any uninstrumented kind and why`
3. No step is fabricated for an operation that has no separable internal phases.
   `inspection: confirm each emitted step corresponds to real, pre-existing execution structure`
4. `node tools/specs.mjs check`/`validate` output and exit codes for unrelated commands
   are unchanged. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```

## Out of scope

- Gate checks, task verification/self-check, task acceptance (task 05).
- Frontend rendering (task 07).
