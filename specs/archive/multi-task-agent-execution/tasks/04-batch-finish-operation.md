---
id: multi-task-agent-execution.batch-finish-operation
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/batch-finish-operation.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/batch-finish/**
  - tools/specs/workflow/cli.mjs
  - tools/tests/batch-finish-operation.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
forbidden_paths:
  - tools/dashboard/**
  - tools/specs/batch/**
  - src/**
depends_on: [ execution-scope-model, batch-queue-reservation, batch-start-and-context-bootstrap ]
semantic_references:
  decisions: [D3, D10, D16, D21, D22, D23, D29, D30, D34, D39]
  constraints: [C2, C5]
  dependency_contracts: [execution-scope-model, batch-queue-reservation, batch-start-and-context-bootstrap]
---

# Task: Batch-finish operation

## Goal

Implement `workflow batch finish` as the corrected D21 durable saga — prevalidate everything in
memory, persist only once validated, apply each task via its own existing finish identity, and
durably reach `completed` — while staying strictly provider-neutral workflow-core: this task never
imports `tools/dashboard/**` and never dispatches continuations itself (D16).

## Dependencies

`execution-scope-model` (`ExecutionScope`, trusted-identity primitives), `batch-queue-reservation`
(the reservation/`batchExecutionId` this operation reads and validates against),
`batch-start-and-context-bootstrap` (`baseRevision` this operation checks).

## Implementation constraints

- **D21 ordering — non-negotiable**: (0) trusted-authorization check; (1) pure, in-memory
  prevalidation of every task's result, `finishContract`, `ExecutionScope` match, and Git
  provenance — **zero control-plane/workflow-state durable writes of this operation's own** (D34
  — an already-existing, uncommitted report file the reviewer wrote before calling finish is not
  itself a durable write this stage performs, and a rejected call leaves it untouched); (2) only
  on full success, persist the batch-finish record for the first time with state `validated` (not
  `pending` — there is no durably-written pre-validation state); (3) commit the canonical report
  with an **explicit, report-path-only `include`** (this operation owns that commit, D22/D30 —
  never a default stage-everything include that could absorb `change.yaml`'s bootstrap dirt); (4)
  apply each task's finish using its own existing `finish-operation.mjs` operation-record identity
  — reference it, do not duplicate its mutation logic or its completion status; (5) reach
  `completed` once every referenced per-task finish is durably complete.
- **Trusted authorization (D23)**: verify the calling session's canonical session id, live
  workspace-writer claim, persisted `AgentSession.executionScope`, `batchExecutionId`, and
  reservation all agree before doing anything else. Reject on any mismatch — never trust a bare
  `--batch <id>` argument. No manual/operator recovery path is added in this task; an
  unauthorizable batch fails closed to recovery-required.
- **Read-only provenance against the complete post-bootstrap workspace baseline (D29/D39)**:
  prevalidation checks `HEAD == baseRevision` and recomputes the deterministic workspace-delta
  fingerprint relative to that revision. After excluding `.nevo-ai-local/**` and only the exact
  canonical report path, it must equal the frozen post-bootstrap fingerprint exactly. The
  fingerprint includes staged/unstaged tracked modifications/deletions and untracked files, so
  expected bootstrap `change.yaml` is accepted but an unrelated modified doc/source file or a
  newly-created untracked source file is rejected.
- **Report-commit identity and no re-check-from-scratch on resume (D30)**: the report commit's
  completion (recorded SHA) is its own durable stage inside the batch-finish record. Once it is
  recorded complete, resume reuses that SHA and never re-commits — and **never re-runs the
  original `HEAD == baseRevision` prevalidation check as though the operation had never started**,
  since `HEAD` has legitimately advanced by the report commit itself.
- **No continuation dispatch, ever, from this task's own code (D16)** — this task's
  responsibility ends at durably exposing `completed`. Do not import, call, or reference anything
  under `tools/dashboard/**`. Do not release the queue reservation or the workspace-writer claim —
  `batch-completion-orchestration` (a later task) does both, in its own defined order (D35).
- Reuse `tools/specs/workflow/finish-operation.mjs`'s existing per-task mutation stages
  (`verify-gates, update-task, commit, push, transition`) unchanged.
- Reuse the existing `finishContract` validation per task — a submitted `result` is checked
  against that task's own current step's declared `transitions[].value` set; never a hardcoded
  `pass`/`fail` enum.
- **Any single invalid result, scope mismatch, or provenance violation rejects the whole call
  before any durable write happens** (D10, D21) — not merely "before task state changes."
- Idempotent resume: a crash before stage 2 wrote anything is a clean retry (stages 0/1 re-run in
  full); a crash after stage 2 resumes by reading the record's own frozen per-stage state (report
  commit done? per-task finish A done?), continuing only the incomplete stages/tasks — the batch
  record's own state is never treated as authoritative over those per-task operations' own state,
  and prior stages are never blindly re-validated from scratch.
- This neighborhood (`finish-operation.mjs`, `cli.mjs`) is active ground (C5) — re-read current
  file contents before editing.

## Acceptance criteria

- Given three tasks with valid results, **on a fixture where batch start has already dirtied
  `change.yaml`** (the realistic post-bootstrap case), the record reaches `completed`, all three
  tasks show independent transition/history/feedback entries, and the report is committed exactly
  once with an include list containing only the report path.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Given three tasks where one result is invalid, no batch-finish record file is created, no
  `change.yaml` mutation from finish occurs, and no per-task finish operation starts — while a
  report file the reviewer already wrote before the call remains present and untouched — and the
  call reports the specific invalid task.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- A prevalidation failure on provenance (`HEAD != baseRevision`, unexpected tracked/index
  delta, or an unrelated untracked repository-visible file) is rejected the same way. Tests cover
  both a modified tracked source/doc file and a newly-created untracked source file; expected
  bootstrap `change.yaml` remains valid.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Simulating a crash **immediately after the report commit lands** (before any per-task finish),
  then resuming: resume does not reject on the grounds that `HEAD` advanced past `baseRevision` —
  it recognizes the report commit as its own recorded stage — and the report is not committed a
  second time. `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Simulating a crash after the report commit **and** task A's finish, then resuming, completes
  exactly B and C, without re-touching A or re-committing the report.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- A batch-finish call whose trusted identity/`executionScope`/`batchExecutionId`/reservation/
  workspace claim don't all agree is rejected — proven per mismatch case (wrong session, wrong
  scope, wrong `batchExecutionId`, wrong reservation, wrong claim owner).
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- This task's own source contains zero references to `tools/dashboard/**` — an explicit,
  automated boundary check, not merely an unstated convention.
  `automated: node --test tools/tests/batch-finish-operation.test.mjs`
- Existing single-task finish behavior is unchanged.
  `automated: node --test tools/tests/workflow-finish-operation.test.mjs`

## Verification

```bash
node --test tools/tests/batch-finish-operation.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

Update `docs/development/agent-workflow-protocol.md`'s finish-operation description to note the
corrected batch-finish envelope (prevalidate → persist `validated` → commit report → apply →
`completed`) and that continuation dispatch is explicitly not this operation's responsibility, in
the same branch.

## Out of scope

The reviewer's own judgment/skill (`multi-task-review-skill`). The `BatchContext`/report
*content* (`batch-start-and-context-bootstrap` builds `BatchContext`; `batch-report` renders it)
— this task only commits the already-written report file. Continuation-barrier release,
workspace-writer claim release, dispatch, and releasing the queue reservation
(`batch-completion-orchestration`, D16/D35).
