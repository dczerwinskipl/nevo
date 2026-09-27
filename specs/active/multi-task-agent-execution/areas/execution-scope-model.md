# Area: Execution scope model

## Responsibility

Define the `ExecutionScope` type and thread it through `AgentSession`, `SessionTaskBinding`, and
the workspace-writer claim as the canonical representation of what task(s) one execution owns —
replacing any future temptation to fake multi-task ownership via `activeTaskId`/`claim.taskId`.
This area is the foundation every other area in this change builds on.

## Current state

- `AgentSession` (`tools/dashboard/server/ai/sessions/binding-service.mjs`, `normalizeStorageContent`
  lines 273–356, `bindSession`/`bindSessionSync` lines 853–1117): `taskIds: string[]` (array,
  used only for lookup), `activeTaskId?: string` (single scalar — the one authoritative "current"
  task; `resolveCurrentBinding`/`resolveCurrentBindingSync`, lines 1119–1212, pick the single
  binding matching it), `parentSessionId?: string` (single scalar).
- `SessionTaskBinding` (`bindSession`, lines 940–963): `{sessionId, taskId, step?, attempt?,
  specId, provider, createdAt, lastSeenAt}` — one row per `(sessionId, taskId)` pair.
- Workspace-writer claim (`tools/specs/workflow/workspace-writer.mjs`, lines 209–223):
  `{ownerId, kind, status, requestId?, operationRef?, specId, changeSlug?, taskId?, sessionId?,
  turnId?, turnStartState?, pid, createdAt}` — `taskId` optional, singular, never an array.
- `admitAgentExecution(specId, candidate, options)` (`tools/dashboard/server/ai/orchestration/admission.mjs`,
  line 73): line 79 requires `candidate.taskId` (singular); `activeExecutions` map (line 19) is
  keyed `specId -> {ownerId, sessionId, turnId, taskId (singular), candidate}`.
- D33 (`specs/active/deterministic-status-architecture/owner-decisions.md`): at most one
  agent-owned execution per specification at a time — enforced independently by the queue
  evaluator, `admission.mjs`'s `activeExecutions`, and `reconciliation.mjs`.

## Requirements

- Introduce `ExecutionScope` as a shared type/validator (new module, e.g.
  `tools/specs/workflow/execution-scope.mjs`) with exactly two shapes:
  `{kind: "task", taskId}` and `{kind: "task-batch", taskIds: string[]}` (`taskIds.length >= 2`
  for a batch — a single-task batch is malformed input, not a batch).
- `AgentSession` gains a persisted `executionScope: ExecutionScope` field.
  - For `kind: "task"`: `activeTaskId` continues to mirror `executionScope.taskId` exactly (zero
    behavior change for existing single-task consumers).
  - For `kind: "task-batch"`: `executionScope.taskIds` is the sole canonical membership/ownership
    record (D2). `activeTaskId` is not populated as a stand-in for any one member task; existing
    code paths that read `activeTaskId` must treat its absence on a batch session as "no single
    authoritative task," never default to the first `taskIds` entry.
  - `taskIds` (the existing array field) continues to serve its established lookup role and is
    always equal to `executionScope.taskIds` regardless of `kind`.
- The workspace-writer claim's optional singular `taskId` is replaced by an optional
  `scope: ExecutionScope` field. A claim for a single-task execution has
  `scope: {kind: "task", taskId}`; a claim for a batch execution has
  `scope: {kind: "task-batch", taskIds}`.
- **Deserialization and normalization boundary for workspace-writer claims (D2)**:
  - When reading `.nevo-ai-local/claims/workspace-writer.json`:
    - Legacy claim records on disk may lack `scope` and only contain a scalar `taskId: string`.
    - At the deserialization/read boundary, if `scope` is absent but `taskId` is present, it must normalize into `scope: { kind: 'task', taskId }`.
    - If a claim record lacks both a valid `scope` and a valid legacy `taskId`, or is structurally invalid/corrupted: the system must fail closed and treat the claim as invalid or recovery-required.
    - All runtime consumers (`workspace-writer.mjs`, `admission.mjs`, `reconciliation.mjs`, CLI status) read and operate strictly on normalized `scope`.
  - When persisting new or updated claims:
    - Single-task writes persist `scope: { kind: 'task', taskId }` (and may mirror scalar `taskId` for backwards read compatibility, though all internal code treats `scope` as canonical);
    - Batch writes persist `scope: { kind: 'task-batch', taskIds }` with NO scalar `taskId`.
- `admitAgentExecution`'s `candidate` accepts `scope: ExecutionScope` instead of a bare
  `taskId`; `activeExecutions`' stored value carries `scope`, not a singular `taskId`. D33 is
  unchanged: `activeExecutions` still holds at most one entry per `specId`, regardless of how
  many tasks that one entry's scope covers.
- `SessionTaskBinding` is unaffected in shape (it already models one `(sessionId, taskId)` pair);
  a batch session simply accumulates one binding row per member task, exactly as multi-task
  `taskIds` already does today.

## Constraints

- C1 (D33) — a `task-batch` scope still yields exactly one `activeExecutions` entry, one
  workspace-writer claim, one session. Nothing in this area may allow two simultaneous claims or
  two simultaneous `activeExecutions` entries for one spec.
- C3 — the workspace-writer claim remains the sole durable physical-workspace ownership
  authority; `ExecutionScope` describes what the one owning execution's logical scope is, it does
  not introduce a second ownership record.
- No `primaryTaskId`/representative-task field is added (D2) — if a later change proves a real
  need, it is modeled as separate, explicit, non-ownership metadata, not retrofitted onto
  `activeTaskId`/`claim.taskId`.

## Interfaces and boundaries

Exposes: the `ExecutionScope` type/validator, consumed by every other area in this change
(`batch-queue-reservation`'s reservation record, `batch-finish-operation`'s durable record,
`batch-context-and-report`'s lineage field) and by `admission.mjs`/`reconciliation.mjs`/
`binding-service.mjs`/`workspace-writer.mjs` directly. Consumes: nothing new — this area only
restates existing session/claim/admission state through the new type.

## Area-specific acceptance criteria

- A single-task session/claim created through the existing code paths is provably unchanged in
  observable behavior (`activeTaskId` still populated, existing tests for
  `agent-session-attach.test.mjs`/`workspace-writer.test.mjs`/`cli-workspace-execution.test.mjs`
  still pass unmodified).
- Constructing a `kind: "task-batch"` session/claim never populates `activeTaskId`/legacy
  `claim.taskId` with any member task's id — proven directly, not by absence of a counterexample.
- `admitAgentExecution` given a `task-batch` candidate still yields exactly one
  `activeExecutions` entry for that spec, and a second admission attempt for any task already
  covered by that scope is refused exactly as a single-task admission conflict is refused today.
- `tools/specs/workflow/queue/**` still contains zero imports of `tools/dashboard/**`.

## Dependencies

None within this change — this is the foundational area every other area depends on.

## Out of scope

The queue reservation mechanism itself (`batch-queue-reservation`), the batch-finish operation
(`batch-finish-operation`), context delivery and reporting (`batch-context-and-report`), and any
UI (`dashboard-batch-review-ux`) — this area only defines and wires the scope type through the
session/claim/admission layer.
