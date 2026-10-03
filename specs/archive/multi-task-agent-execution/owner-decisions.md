# Owner decisions — multi-task-agent-execution

## D1: Workflow mode for this change

- **Question:** `AGENTS.md` gates `workflow.mode` selection explicitly — must this change's own
  tasks run under the legacy or deterministic lifecycle?
- **Options considered:** `legacy` | `deterministic`
- **Decision:** `legacy` (corrected 2026-09-27 — original decision below was based on a
  conflated rationale).
- **Rationale:** `workflow.mode` governs how *this change's own tasks* are tracked/approved/
  executed while someone implements them — it is orthogonal to what the resulting feature's code
  touches. The original "deterministic" answer wrongly inferred the former from the latter (the
  feature extends the deterministic engine's internals, but that doesn't mean tracking this
  change's own 6 tasks needs the deterministic lifecycle). The deterministic lifecycle is also
  the one under active corrective churn right now (C5 — 4 fix commits in the ~30 hours before
  this spec was written); legacy is the stable, proven lifecycle for tracking implementation work
  regardless of what that work builds.
- **Consequences:** `change.yaml` declares `workflow: {mode: legacy}` (matching
  `deterministic-status-architecture`'s own choice for the same reason — D4 there). Tasks use the
  legacy `approve`/`start`/`complete`/`verify` cycle, not `workflow step start`/`workflow step
  finish`. No area/task *content* changes — every task's own acceptance criteria/verification
  describe the feature being built, not this change's own tracking mechanism, and are unaffected.
- **Date:** 2026-09-27 (corrected same day)
- **Affected artifacts:** `change.yaml`

<details><summary>Original decision (corrected above)</summary>

- **Decision:** `deterministic`.
- **Rationale:** The feature extends the deterministic engine directly; running its own tasks
  under the same engine is the natural fit.
- **Consequences:** `change.yaml` declares `workflow: {mode: deterministic, version: 1,
  definition: standard-v1}`, matching `ai-spec-history`. Tasks use `workflow step start`/`workflow
  step finish`, not the legacy `approve`/`start`/`complete`/`verify` cycle.

</details>

## D2: Execution scope representation

- **Question:** How should a session/claim/queue-item that owns more than one task be
  represented, without faking it via `activeTaskId = first task`?
- **Options considered:**
  1. Minimal — loosen existing `taskIds`/`claim.taskId` with no new discriminator field.
  2. Balanced — explicit, persisted `ExecutionScope` (`{kind, taskIds}`) on `AgentSession`, the
     workspace-writer claim, and a new queue reservation record; existing scalars
     (`activeTaskId`/`claim.taskId`) kept only for `kind: "task"`, never promoted to authoritative
     for a batch.
  3. Target shape — converge with `remediation-review`'s two-pass module and
     `implementation-review`'s fresh-subagent pattern into one general multi-task execution
     primitive now.
- **Decision:** Option 2, with a correction to how it was originally proposed: **for
  `kind: "task-batch"`, the `ExecutionScope` itself is the sole canonical source of truth for
  execution ownership and membership.** `activeTaskId`/`claim.taskId` must never be treated as
  authoritative for a batch, not even as a "representative task." If a primary task is genuinely
  needed for UI/navigation, it must be modeled as separate, explicit, non-ownership metadata —
  not reused from the existing singular fields. No such need is proven yet (see overview
  "Out of scope"), so v1 does not introduce a `primaryTaskId` field at all.
- **Deserialization and normalization boundary:**
  - Workspace-writer claim storage on disk (`.nevo-ai-local/claims/workspace-writer.json`):
    - Legacy claim records may lack `scope` and only have `taskId: string`.
    - When loading an existing claim, if `scope` is absent but `taskId` is present, it must normalize at the boundary into `scope: { kind: 'task', taskId }`.
    - If a claim record has neither a valid `scope` nor a valid legacy `taskId`, or has an invalid/corrupt structure: fail closed / treat claim as invalid or recovery-required.
    - All runtime consumers (admission, contention checks, release, CLI status) must read and operate strictly on normalized `scope`.
    - When persisting new or updated claims:
      - Single-task writes persist `scope: { kind: 'task', taskId }` (and may mirror `taskId` for backwards read compatibility if required, but new code treats `scope` as canonical);
      - Batch writes persist `scope: { kind: 'task-batch', taskIds }` with NO scalar `taskId`.
- **Rationale:** Reusing the existing singular fields as an implicit "representative" is exactly
  the anti-pattern the original brief forbids and is too easy to later treat as a real scope.
- **Consequences:** `ExecutionScope` for `kind: "task"` is `{kind: "task", taskId}` (existing
  scalar fields continue to mirror it, zero behavior change for single-task flows); for
  `kind: "task-batch"` it is `{kind: "task-batch", taskIds}` with no scalar substitute anywhere.
  Option 3's convergence remains reachable later as a follow-up once this scope model is proven —
  not foreclosed by this decision.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/execution-scope-model.md`, `tasks/01-execution-scope-model.md`

## D3: Batch-finish mechanism — durable continuation barrier (not atomic transaction)

- **Question:** How does one batch-finish operation avoid a continuation firing for task A while
  the reviewer is still producing results for B/C, and how is reliability ensured without
  distributed atomic rollback?
- **Options considered:**
  1. Minimal — loop the existing single-task finish, buffer continuations in-process.
  2. Balanced — durable resumable batch-finish saga and continuation barrier: a durable batch-finish
     record, written and validated before any task mutation; per-task mutation applied idempotently
     from that record; continuations recomputed/dispatched only after every task's mutation is
     durably confirmed.
  3. Target shape — a general atomic multi-task write transaction at the `change.yaml` lifecycle
     layer, reusable by `bulk-transition` too.
- **Decision:** Option 2: **A durable resumable batch-finish saga and continuation barrier, NOT an
  atomic transaction.** Corrected in full by D21 below (the original ordering here — "record
  intent as `pending`" before validation — contradicted D10's "no partial acceptance"; D21 is the
  authoritative sequence now, this entry is kept for the audit trail).
- **Rationale:** Guarantees crash-recoverability and prevents premature downstream continuations
  without attempting impossible cross-repository atomic transactions. Option 1 has no real
  crash-recovery story; Option 3 touches the core lifecycle-write path everything else depends on,
  for a benefit outside this change's scope.
- **Consequences:** A new durable batch-finish record family (mirrors the existing
  intent-then-derive convention `batch.json`/`follow-ups.yaml` already use). See D21 for the
  corrected exact ordering.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-finish-operation.md`, `tasks/04-batch-finish-operation.md`

## D4: Read-only reviewer capability profile for batched review

- **Question:** May a batch reviewer edit source files directly, or only inspect and report?
- **Options considered:** Read-only capability profile (inspect, report, assign verdicts/feedback; a
  failed task gets a fresh single-task refiner) | Writable profile (reviewer can fix directly, but
  raises attribution questions — which task owns the edit, which `allowed_paths` apply, whose
  provenance changes).
- **Decision:** Read-only capability profile for v1.
  - Batched review v1 is an explicit execution capability profile:
    - No source-file writes permitted;
    - Allowed writes are strictly limited to the canonical review report (`reviews/review-batch-<batchExecutionId>.md`)
      and the batch-finish mutation.
  - Single-task review retains its existing capability profile (including corrective edits where
    configured, e.g. `executeReviewWorkflowStep`). Do not conflate batch review's read-only profile
    with single-task review behavior.
  - Enforcement mechanisms are ownership-resolved by D27 below — the control-plane post-condition
    check is mandatory, provider tool sandboxing is optional defense-in-depth only.
  - A failing task proceeds through the existing single-task fresh refiner role unchanged.
- **Rationale:** Avoids multi-task file ownership, attribution, and merge provenance ambiguity across
  concurrent task scopes without weakening single-task review capabilities.
- **Consequences:** The batch reviewer session/skill is granted no write access to source paths for
  v1; only its own report file and the batch-finish call are writes. Attempted source edits fail closed.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/multi-task-review-skill.md`, `tasks/07-multi-task-review-skill.md`

## D5: Grouping trigger

- **Question:** Is a review batch formed automatically or only on explicit request?
- **Decision:** Explicit/user-triggered in v1. Automatic grouping is deferred (no repository
  evidence of an existing auto-grouping heuristic to build on, and it multiplies the decisions
  D2/D9 already have to get right).
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-queue-reservation.md`

## D6: Batch size limit

- **Question:** Is there an architectural cap on how many tasks one batch may cover?
- **Decision:** No arbitrary hard architectural limit. The UI may recommend a small practical
  scope, but nothing in the runtime model enforces a number. (See D26 — a *runtime/context-capacity*
  preflight is a distinct, non-architectural concern this decision does not rule out.)
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/dashboard-batch-review-ux.md`

## D7: Report structure

- **Question:** One shared report or one per task?
- **Decision:** One canonical shared batch report (`reviews/review-batch-<batchExecutionId>.md`)
  plus a durable per-task reference/anchor into it — never a full copy per task.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-report.md`, `tasks/05-batch-report.md` (renamed from
  `batch-context-and-report` by D32)

## D8: Lineage representation and fail-closed resolution

- **Question:** How does a batch reviewer session record its relationship to each member task's
  own prior implementer session, given `parentSessionId` is a single scalar?
- **Decision:** Explicit per-task predecessor relation into the batch session — do not flatten N
  parents into one `parentSessionId` scalar.
- **Fail-closed lineage resolution semantics:**
  - For each member task, predecessor lineage is resolved as follows:
    1. Check if the task's current workflow step has an authoritative exact history binding (e.g. `history.sessionId` from the preceding incoming transition);
    2. If not, inspect `stepBindings` / durable session index for sessions bound to that task at its preceding step:
       - If exactly one active/completed session exists for that task there, use it;
       - If multiple exist (ambiguous lineage) or none exists: fail closed to `sessionId: null` rather than guessing or picking the newest;
    3. Predecessor context in `BatchContext` must explicitly represent missing or ambiguous lineage as unavailable/null, so the review agent knows implementation context was partial rather than hallucinating lineage.
- **Rationale:** Matches the existing code's own principle (confirmed in discovery: queue
  advancement already sets `parentSessionId: null` rather than fabricate cross-task lineage) —
  extending that scalar to secretly encode multiple parents would violate the same principle it
  already protects.
- **Consequences:** A new, additive, optional `predecessorSessions: {taskId, sessionId}[]` field
  on `AgentSession`, populated only for `kind: "task-batch"` sessions. `parentSessionId` stays
  `null` for a batch session and continues to mean exactly what it means today for `kind: "task"`
  sessions (including the refiner session spawned after a batch-reviewed task fails, whose own
  `parentSessionId` is the batch session's id — a genuinely singular predecessor). **Wording
  corrected by D25** — the resolution steps above originally named the preceding step
  "implementer" literally; the mechanism is unchanged, only the role-name-agnostic wording is
  corrected.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `tasks/03-batch-start-and-context-bootstrap.md` (lineage resolution/persistence moved here from
  the renamed `batch-context-and-report` by D32)

## D9: Queue interaction

- **Question:** How does the sequential queue avoid dispatching a grouped item elsewhere while a
  batch execution owns it?
- **Decision:** Durable reservation of the exact grouped queue items, consumed as one unit by one
  execution. Ordinary single-item scheduling is unaffected for every other queue item.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-queue-reservation.md`, `tasks/02-batch-queue-reservation.md`

## D10: Invalid task result inside a batch-finish call

- **Question:** If one task's submitted result in a batch-finish payload is invalid, what happens
  to the rest?
- **Decision:** Reject the whole batch-finish call before any task mutation — never partial
  acceptance. **Sharpened by D21**: "before any task mutation" means before any durable write at
  all, not merely before `change.yaml` changes.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-finish-operation.md`, `tasks/04-batch-finish-operation.md`

## D11: Cross-task findings shape

- **Question:** How are cross-task findings attributed?
- **Decision:** Batch-level findings, each carrying an explicit list of affected task IDs — never
  an unattributed, batch-wide note.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md` (computes findings),
  `areas/batch-report.md` (renders them) — both renamed/relocated from the original
  `batch-context-and-report` by D32

## D12: Batch compatibility, execution policy, and session semantics

- **Question:** How are batch eligibility, execution policy, and session reuse resolved for a batch session?
- **Decision:**
  - **Batch compatibility criteria:** Tasks can only be grouped into a single batch execution if:
    1. They belong to the same change (`spec_id` / `slug`);
    2. They are currently targeting the exact same workflow step (e.g. `review`);
    3. That step's authoritative incoming transition resolves the same role (e.g. `reviewer`) —
       resolved via D20's shared resolver, never re-derived inline (role/session belong to the
       transition, never the step);
    4. All tasks are individually eligible/runnable for that step (no pending prerequisites or unsatisfied gate conditions);
    5. All member tasks require `session: fresh` semantics for the batch session in v1. A batch review execution always runs in a fresh dedicated session — it never attaches to an existing single-task session.
  - **Execution policy resolution:**
    - Provider and mode are selected once for the batch execution, not per task.
    - If individual tasks have conflicting task-level overrides in `executionPolicy`:
      - The UI/CLI must detect and surface the override conflict;
      - The user must explicitly choose the execution configuration for the batch (or one-off override), rather than silently inheriting the first task's override.
    - If all grouped tasks share the same resolved policy or fall back to the same role/default policy, that policy is preselected.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-queue-reservation.md`, `areas/dashboard-batch-review-ux.md`, `tasks/02-batch-queue-reservation.md`

## D13: Core abstraction breadth vs. v1 behavior

- **Question:** Should `ExecutionScope`/`task-batch` be reviewer-specific, or a general
  primitive?
- **Decision:** The core abstraction (`ExecutionScope`, the workspace-writer claim extension, the
  queue reservation, the batch-finish operation) is generic and not reviewer-specific. Only the
  v1 *behavior and UI* are restricted to the reviewer role — no other role gets an actual
  execution path wired up yet.
- **Consequences:** A future role (e.g. a multi-task refiner) can reuse the same scope/claim/
  queue/finish primitives without redesign; this change does not build or wire that path.
- **Date:** 2026-09-27
- **Affected artifacts:** `overview.md` ("Proposed architecture", "Out of scope")

<!-- D14–D27 below close implementation-readiness gaps a corrective review found in D1–D13's
     original text (2026-09-28). Each states which earlier decision it extends/corrects; none
     reopen D1/D5/D6/D7/D9/D10/D11/D12/D13's own core choice. -->

## D14: Batch-start/bootstrap operation

- **Question:** Deterministic single-task execution requires `workflow step start <change>
  <task>` to activate a step, establish attempt identity, and return authoritative
  `StepContext`. A `task-batch` execution has no singular `taskId` and no `activeTaskId` — what
  activates every member's target step and produces the reviewer's context?
- **Decision:** Define an explicit batch-start/bootstrap operation, conceptually
  `workflow batch start <change> --batch <batchExecutionId>` (exact naming open). It: (1)
  resolves the trusted current batch execution identity; (2) validates the request against the
  exact reserved `ExecutionScope`; (3) re-verifies every member is still compatible/ready; (4)
  resolves the shared target step / incoming execution role / session semantics via one pure
  resolver (D20); (5) activates every member's target step, reusing the single-task step
  activation mechanism per member, idempotently; (6) produces one authoritative deterministic
  `StepContext` per member; (7) builds one deduplicated `BatchContext` from those `StepContext`s
  (D15); (8) returns that `BatchContext` to the reviewer session. The reviewer never calls N
  independent `workflow step start` commands itself.
- **Rationale:** Without this, "read common context once" has no operation that actually
  produces it from the authoritative deterministic contract — `batch-context-and-report`'s
  original text silently called the legacy per-task packet builder directly, which is not this
  operation's job to invent ad hoc.
- **Consequences:** New area/task `batch-start-and-context-bootstrap`, depending on
  `execution-scope-model` and `batch-queue-reservation`. Partial activation (some members
  activated, then a crash) must be idempotently resumable — activating an already-activated
  member is a no-op keyed off that member's own durable step-activation record, never a second
  activation attempt. A member that fails re-verification at step (3) fails the whole bootstrap
  before any member is activated — same "validate all before mutating any" discipline as D21.
- **Date:** 2026-09-28
- **Affected artifacts:** new `areas/batch-start-and-context-bootstrap.md`, new
  `tasks/03-batch-start-and-context-bootstrap.md`, `overview.md`

## D15: BatchContext derives from deterministic StepContext, not the legacy context packet

- **Question:** `batch-context-and-report`'s original text built `BatchContext` by calling
  `buildContextPacket(change, task)` — the legacy, non-deterministic context packet — once per
  member task. Is that the right source?
- **Decision:** No. `BatchContext` must be derived from the authoritative deterministic
  `StepContext`s the batch-start operation (D14) resolves for each member — the same contract
  `workflow step start` already produces for a single task (`taskDefinition`, `requiredContext`,
  `relevantDocs`, `stepContract`, `previousTransition`, `expectedWork`, allowed/forbidden paths,
  `finishContract`, gates). `buildContextPacket` is not reused for this purpose.
- **Rationale:** `buildContextPacket` is the legacy lifecycle's own contract, not the
  deterministic engine's — using it here would make the reviewer's actual working contract
  diverge from what `workflow step finish` later validates against. Deduplication still happens
  (this doesn't reopen the "no content-hash/context-refresh subsystem" scope limit) — it dedupes
  `requiredContext` documents, `relevantDocs`, and shared files across the resolved
  `StepContext`s, while preserving per-task attribution (`usedBy`, `taskDefinition`,
  `stepContract`, `finishContract`, `previousTransition`, allowed/forbidden paths).
- **Consequences:** `batch-context-and-report` now depends on
  `batch-start-and-context-bootstrap` (consumes its resolved `StepContext`s) in addition to
  `execution-scope-model`. `tools/specs/context.mjs`'s `buildContextPacket` is unaffected —
  single-task legacy flows keep using it exactly as before.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-context-and-report.md`,
  `tasks/05-batch-context-and-report.md`

## D16: Batch-finish (domain) and continuation-barrier release (orchestration) are separate

- **Question:** Task 03's original text lived entirely under `tools/specs/workflow/**`
  (forbidding `tools/dashboard/**`) yet also promised to "recompute and dispatch continuations
  for all affected tasks" — continuation dispatch is dashboard-orchestration territory
  (`reconciliation.mjs`, Hook1), not workflow-core. Both cannot be true in one task with that
  path scope.
- **Decision:** Split the two. `batch-finish-operation` (workflow-core, provider-neutral) is
  responsible only for durably reaching `completed` and exposing sufficient durable facts — it
  never imports or calls into `tools/dashboard/**`. A new, separate
  `batch-completion-orchestration` area/task (dashboard layer) owns: batch-aware Hook1 terminal
  settlement observation, detecting batch completion (reading the durable batch-finish record),
  releasing the continuation barrier, and reconciling/dispatching every affected task's next
  action — reusing the existing single-task continuation-dispatch function per task, called only
  from this observer, never from inside `batch-finish-operation` itself.
- **Rationale:** Matches the accepted architecture's own boundary
  (`docs/development/workflow-engine.md`: workflow core never imports dashboard orchestration) —
  the original text violated it by construction, not by oversight.
- **Consequences:** New area/task `batch-completion-orchestration`, depending on
  `batch-finish-operation` and `batch-queue-reservation` (releases the reservation it consumes).
- **Date:** 2026-09-28
- **Affected artifacts:** new `areas/batch-completion-orchestration.md`, new
  `tasks/06-batch-completion-orchestration.md`, `areas/batch-finish-operation.md`,
  `tasks/04-batch-finish-operation.md`, `overview.md` (constraint C2 generalized)

## D17: Continuation barrier scope — blocks every downstream action, not just queue dispatch

- **Question:** Queue reservation alone doesn't stop a *different* mechanism from acting on a
  partially-batch-finished task — e.g. task A's `workflow_progress` already shows
  `human-verification` after A's own mutation lands, while B/C are still being applied; could the
  human-interaction surface let someone submit A's human step before the batch is complete?
- **Decision:** The simpler of the two invariants the corrective review offered: **partial task
  state may become observable once a member's own mutation lands, but no downstream
  action/continuation is *executable* for any batch member until the whole batch reaches
  `completed`.** This covers, explicitly: automatic agent continuation, sequential queue
  dispatch, human-interaction submission, and any other workflow start/continuation touching a
  batch member. Represented by an active batch-barrier record (keyed by `batchExecutionId`,
  D18), consulted by readiness/action projection and by reconciliation before any of those four
  action paths executes for a task that record still lists as barriered.
- **Rationale:** "Not externally visible" (the original overview wording) is stronger than what
  the actual mechanism (queue reservation only) delivered — this decision makes the true,
  achievable invariant explicit instead of overclaiming state-level invisibility the design
  doesn't actually provide.
- **Consequences:** `overview.md`'s "Change-wide acceptance criteria" wording is corrected from
  "no task's own workflow transition becomes externally visible... until durably validated" to
  the action-blocking invariant above. `batch-completion-orchestration` (D16) owns clearing the
  barrier record.
- **Date:** 2026-09-28
- **Affected artifacts:** `overview.md`, `areas/batch-completion-orchestration.md`,
  `tasks/06-batch-completion-orchestration.md`

## D18: One canonical `batchExecutionId`

- **Question:** The original text used `reservationId` (queue reservation), `batchExecutionId`
  (finish record, report path), and implied session/runtime identities without defining how they
  relate — are they the same identity or several?
- **Decision:** One canonical correlation identity, `batchExecutionId`, generated exactly once
  when the compatible group is reserved (`batch-queue-reservation`). It is carried through,
  unchanged: the queue reservation record (replacing the separate `reservationId`), the batch
  `AgentSession`'s runtime metadata, workspace-writer claim correlation metadata where useful,
  `BatchContext`, the review report path (`review-batch-<batchExecutionId>.md`, already the
  convention), the batch-start operation (D14), the batch-finish record, and recovery/UI
  references.
- **Rationale:** `ExecutionScope` (`{kind: "task-batch", taskIds}`) remains the canonical
  *membership/ownership* source (D2, unchanged) — `batchExecutionId` is purely a correlation
  identity for tying together the durable records that describe one batch's lifecycle, not a
  second scope-ownership authority. Two separate IDs for the same lifecycle invited exactly the
  ambiguity D10/D23 need to rule out.
- **Consequences:** `batch-queue-reservation`'s reservation record field renames `reservationId`
  → `batchExecutionId`. No other identity is introduced.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-queue-reservation.md`,
  `tasks/02-batch-queue-reservation.md`, and every other area/task referencing
  `batchExecutionId`/`reservationId`

## D19: Batch-aware reservation settlement and synchronous rollback

- **Question:** The original text said reservation crash-recovery "reuses
  `assessExecutionSettlement`" — but the existing checker's signature is singular
  (`assessExecutionSettlement({ taskId })`). A batch reservation can't be reconciled by checking
  one arbitrary member as a representative.
- **Decision:** Reservation recovery uses a scope-aware settlement check — conceptually
  `assessExecutionSettlement({ executionScope, batchExecutionId, ... })` or a dedicated batch
  checker — that verifies the durable batch session/finish state as a whole, never by picking
  one member task as representative. Separately: if reservation succeeds but admission/session
  creation then fails, the reservation is released **synchronously, in the same call**, not left
  for boot-time recovery to discover later.
- **Rationale:** A representative-member check can be wrong in either direction (the
  representative settled but another member didn't, or vice versa) — the whole point of
  `ExecutionScope` being the canonical membership source (D2) is that no single member stands in
  for the batch anywhere, including in recovery logic.
- **Consequences:** The reservation's durable record carries enough correlation
  (`batchExecutionId`, the batch session id once created) to prove which execution owns it,
  independent of any one member task's own state.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-queue-reservation.md`,
  `tasks/02-batch-queue-reservation.md`

## D20: One shared, pure incoming-transition resolver — reused everywhere, never duplicated

- **Question:** Batch compatibility needs to check "same authoritative incoming role" and
  "`session: fresh`" — but the queue/`ExecutionReadiness` layer doesn't expose transition
  `execution.role`/`execution.session` today, and duplicating the matching logic inline (as
  dashboard `turns/routes.mjs` was independently found to have done, ambiguously, in the sibling
  `deterministic-status-architecture` corrective pass) is exactly the mistake to avoid repeating
  here.
- **Decision:** Define or extract one pure workflow-domain resolver — conceptually
  `resolveIncomingExecution(task, definition, targetStep)` returning `{transition, role,
  session}` or an explicit `{ambiguous: true}` / `{error: ...}` result — reused by dashboard
  orchestration, single-task execution, batch compatibility checking, and batch start (D14). It
  preserves the existing fail-closed transition-matching semantics (ambiguous match → explicit
  failure, never a guessed role). Every place in this spec that said "same role" or "step has the
  same role" is corrected to "tasks resolve the same authoritative incoming-transition role" —
  role/session belong to the transition, never the step (matches the sibling change's own D26,
  which this spec does not reopen, only aligns its wording with).
- **Rationale:** One resolver, reused, is the only way to guarantee batch compatibility checking
  and single-task execution can never silently disagree about a task's authoritative role.
- **Consequences:** Owned by `execution-scope-model` (the foundational area every other area
  already depends on) rather than duplicated into `batch-queue-reservation` or
  `batch-start-and-context-bootstrap`.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/execution-scope-model.md`,
  `tasks/01-execution-scope-model.md`, `areas/batch-queue-reservation.md`,
  `areas/batch-start-and-context-bootstrap.md`

## D21: Batch-finish durable record model — prevalidate, then persist, then apply, then derive

- **Question:** The original D3 said "record intent... state `pending`" *before* "perform
  pre-condition validations," while D10/task-03 said "any invalid result rejects... before any
  durable write." Both cannot be true in the same operation — which happens first?
- **Decision:** Corrects D3's ordering. The batch-finish record model is:
  (A) **Pure prevalidation** — complete task set, exact `ExecutionScope` match, all submitted
  results against each task's own `finishContract`, report presence, read-only Git-provenance
  postconditions (D22) — performed entirely in memory, **zero durable writes**.
  (B) Only once prevalidation fully succeeds, persist the batch-finish record for the first time,
  with state `validated` (not `pending` — there is no pre-validation "pending" state written to
  disk).
  (C) Apply per-task finish using each task's own existing durable single-task finish-operation
  identity (`finish-operation.mjs`'s own record family) — the batch record does not duplicate
  that state, it references those per-task operation identities.
  (D) `applied`/`completed` status is *derived* from the referenced per-task finish operations'
  own authoritative state wherever feasible, not independently duplicated in the batch record in
  a way that could drift from it.
  (E) The batch record reaches `completed` only once every referenced per-task finish is durably
  complete.
- **Rationale:** D10's "no partial acceptance" requirement is meaningless if a `pending` record
  is already durably written before validation — that's itself a durable write reflecting an
  unvalidated batch. This decision makes "validate everything, in memory, before the first
  durable write" the actual, checkable rule.
- **Consequences:** Corrects D3 and task 04's "Record intent... state pending" step and its
  "derive per-task application status from `change.yaml`... or persist per own record" ambiguity
  — replaced by the A–F model above. Crash/resume: a crash before (B) never wrote anything, so
  resume is a clean retry from the original request; a crash after (B) resumes by reading the
  per-task finish-operation identities the record already references and continuing only the
  ones not yet complete.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-finish-operation.md`,
  `tasks/04-batch-finish-operation.md` (D3's text is corrected in place by this decision, not
  duplicated)

## D22: Read-only Git provenance — precise baseline and report commit ownership

- **Question:** "No git commits modifying paths outside the report" can't be checked reliably
  without a baseline revision, and nothing said who actually commits the shared report file.
- **Decision:** At batch start (D14), record `baseRevision = HEAD`. For v1, the reviewer session
  performs **no Git commits at all** — a strict, simply-checkable model. At batch finish, require
  `HEAD == baseRevision` (proving the reviewer made no commit) and that any dirty tracked paths
  are exactly and only the permitted batch-review artifact path(s) — never a "working tree must
  be literally clean" check, since the canonical report itself is an expected uncommitted write
  at that point. The **batch-finish operation** owns committing the canonical report — one
  batch-level commit, created before or alongside the per-task lifecycle commits it triggers via
  D21(C) — so the report is never accidentally attributed to whichever member task happens to
  finish first.
- **Rationale:** A baseline-free "no unexpected commits" check is unverifiable; a literally-clean
  working tree check is wrong because the report itself must exist uncommitted at that point. The
  combination of a recorded baseline plus an explicit allowed-dirty-path set is both precise and
  simple enough for v1.
- **Consequences:** `batch-start-and-context-bootstrap` records `baseRevision`; `batch-finish-operation`
  checks it and owns the report commit; push/failure/resume semantics for that commit follow the
  same durable-operation convention `finish-operation.mjs` already uses for per-task commits.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `areas/batch-finish-operation.md`, `tasks/04-batch-finish-operation.md`

## D23: Trusted execution identity authorizes batch finish — never a bare CLI argument

- **Question:** `workflow batch finish --batch <id>` took the CLI's `--batch` argument as given.
  What stops an arbitrary caller from inventing or mismatching batch scope?
- **Decision:** Same principle deterministic single-task execution already relies on (trusted
  ambient execution context, not client-supplied identity): batch finish requires the calling
  session's trusted ambient execution identity (canonical session id), the live workspace-writer
  claim, the persisted `AgentSession.executionScope`, the `batchExecutionId`, and the queue
  reservation to all agree. Any mismatch — calling session isn't the canonical batch session,
  requested tasks differ from `executionScope`, `batchExecutionId` differs, reservation differs,
  or workspace-claim owner/session differs — is rejected. A separate manual/operator recovery
  path (for a genuinely stuck batch) is explicitly out of scope for this pass — this command
  carries only the agent-session-authorized path; a stuck batch fails closed to
  recovery-required, the same as other durable operations in this repository, rather than this
  command growing implicit manual authority.
- **Rationale:** Mirrors the exact class of gap the sibling `deterministic-status-architecture`
  corrective pass closed for single-task `parentSessionId`/`sessionId` trust — the same
  discipline applies here.
- **Consequences:** No new "operator override" surface is introduced by this change.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-finish-operation.md`,
  `tasks/04-batch-finish-operation.md`

## D24: `SessionTaskBinding` — one real binding per member, and a scope-aware projection

- **Question:** The original `execution-scope-model` text claimed a batch session "simply
  accumulates one binding row per member task, exactly as `taskIds` already does today" — but
  `bindSession()` today creates a `SessionTaskBinding` only for a singular `taskId`, not one per
  `taskIds` array member. That claim is factually wrong, not merely underspecified.
- **Decision:** Batch session creation must create/update one real `SessionTaskBinding` per
  member task (`R↔A`, `R↔B`, `R↔C`), each with its own correct step/attempt identity — this is
  new binding-creation logic, not something the existing code already does. Separately,
  `resolveCurrentBinding` intentionally returns no task when `activeTaskId` is absent (correct,
  unchanged) — a batch session must not make it silently pick a first/arbitrary member instead. A
  **separate, scope-aware projection** (new, alongside `resolveCurrentBinding`) serves batch
  callers that need "every binding for this batch session," never repurposing
  `resolveCurrentBinding` itself for that.
- **Rationale:** An architecture document asserting existing behavior that isn't actually true is
  worse than silence — it would have sent an implementer looking for code that doesn't exist.
- **Consequences:** `execution-scope-model`'s task gains real binding-creation work (previously
  assumed to be free) and a new scope-aware binding projection function.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/execution-scope-model.md`,
  `tasks/01-execution-scope-model.md`

## D25: Lineage resolution is generic — no hardcoded "implementer" role

- **Question:** D8's original resolution steps say "the preceding *implementer* transition" and
  "*implementer* session" by name. V1's only wired role is reviewer, but should the lineage
  *primitive* itself know the word "implementer"?
- **Decision:** No — corrects D8's wording, not its fail-closed resolution logic. The primitive
  resolves "the exact predecessor agent execution for this task's incoming transition/history,"
  generically — never a literal step name or reserved role string. `implementer`/`reviewer`/
  `refiner` remain free-form workflow data (consistent with the sibling change's own D26), not
  reserved application enums baked into this primitive.
- **Rationale:** A future workflow with different role names must not require an application-code
  change to this lineage primitive — hardcoding "implementer" would silently break for any
  workflow that doesn't use that exact role name.
- **Consequences:** `parentSessionId = null` on the batch session and one `predecessorSessions`
  entry per member, fail-closed on ambiguity, are unchanged (D8's actual mechanism stands) — only
  the role-name-agnostic wording is corrected.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-context-and-report.md`,
  `tasks/05-batch-context-and-report.md` (D8's text is corrected in place by this decision)

## D26: Context-capacity preflight is a runtime/capability limit, not an architectural task-count cap

- **Question:** D6 says no arbitrary hard task-count limit — but a large enough `BatchContext`
  can exceed a specific model/provider's actual context budget. Is that the same thing D6 already
  ruled out?
- **Decision:** No — D6 stands unchanged (no architectural N-task limit). Separately, before
  batch start (D14) proceeds to activate members, a preflight check may reject the batch with an
  explicit, distinct failure (conceptually `BATCH_CONTEXT_TOO_LARGE`) if the constructed
  `BatchContext` would exceed the selected model/provider's actual context capacity. This is a
  capability-driven runtime check, not a fixed architectural constant, and never substitutes for
  or reintroduces a task-count cap.
- **Rationale:** Distinguishing "no architectural limit" (D6, a design choice) from "a specific
  provider/model combination has a real capacity ceiling" (a runtime fact) keeps D6 honest
  without pretending context budgets are infinite.
- **Consequences:** `batch-start-and-context-bootstrap` owns this preflight check;
  `dashboard-batch-review-ux` surfaces the failure to the owner (e.g. suggesting a smaller
  selection or a different provider) rather than silently truncating context.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `areas/dashboard-batch-review-ux.md`

## D27: Read-only enforcement ownership — control-plane check is mandatory, provider sandboxing is optional

- **Question:** D4 promised both "provider tool sandboxing where supported" and "control-plane
  post-condition verification," but no task clearly owned implementing either — a promised
  enforcement mechanism with no implementing task is worse than not promising it.
- **Decision:** Option A from the corrective review: the **control-plane post-condition
  verification is the mandatory correctness mechanism** (owned by `batch-finish-operation`, which
  already needs to check Git provenance per D22 — the same check covers this). Provider tool
  capability-profile restriction is explicitly **optional defense-in-depth**, applied only where
  the provider integration already exposes such a capability today — this change does not add new
  provider-integration surface to obtain it, and correctness never depends on it being available.
- **Rationale:** Making the deterministic, always-available mechanism (control-plane
  post-condition check) the one thing correctness depends on means the guarantee holds regardless
  of which provider a batch session uses.
- **Consequences:** No new task is needed solely for provider-side sandboxing; `batch-finish-operation`'s
  existing D22 provenance check is also the D4 read-only enforcement mechanism.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/multi-task-review-skill.md`,
  `areas/batch-finish-operation.md` (D4's enforcement description is corrected in place by this
  decision)

<!-- D28–D36 below close concrete runtime/task-graph contradictions a final implementation-
     readiness review found in D14–D27's own text (2026-09-28, second pass). Each states which
     earlier decision it extends/corrects; none reopen the accepted D1–D27 product model. -->

## D28: Batch start needs its own durable operation record — not `start-operation.mjs`

- **Question:** D14's original text said partial batch-start crash recovery uses "each
  member's own durable step-activation record." Is that true for the v1 case (batch review)?
- **Decision:** No — corrected. `start-operation.mjs` is created by the single-task CLI path
  only when the target step declares `consumesDependencies: true`. In `standard-v1`,
  `implementation` declares it, `review` does not — so A/B/C entering `review` (the v1 batch
  case) have **no** such record to recover from. `batch-start-and-context-bootstrap` must
  persist its **own** durable batch-start operation record — e.g.
  `.nevo-ai-local/batch-start/<changeSlug>/<batchExecutionId>.json` — after all members pass
  pure compatibility/readiness validation but **before** the first member is activated. It
  freezes: `batchExecutionId`, `executionScope`, the canonical session id, each member's target
  step, each member's attempt identity, whatever pre-activation state reconciliation needs, and
  a per-member activation-stage field. Activation then proceeds member-by-member, each one
  reconciled/persisted into this record as it completes. Crash/retry derives, per member,
  whether activation *definitely happened*, *definitely did not happen*, or is
  *ambiguous/recovery-required*, by combining this durable intent with authoritative current
  workflow state — never by assuming a `start-operation.mjs` record exists. Where a member's own
  step *does* declare `consumesDependencies: true`, this record **composes with** that member's
  existing single-task start-operation semantics — it does not replace or duplicate them.
- **Rationale:** An architecture that assumes infrastructure exists only for a config value the
  v1 case doesn't set is not implementation-ready — it would send an implementer looking for a
  crash-recovery mechanism that silently isn't there for the exact case this spec targets.
- **Consequences:** `batch-start-and-context-bootstrap` gains its own durable operation-record
  module, parallel to (not built from) `finish-operation.mjs`'s and `start-operation.mjs`'s own
  families.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `tasks/03-batch-start-and-context-bootstrap.md`

## D29: Read-only Git baseline is recorded post-bootstrap, not pre-activation (corrects D22)

- **Question:** D22 recorded `baseRevision = HEAD` "at the point activation begins." But
  `ensureStepActivated()` mutates the tracked `change.yaml` as part of activating each member,
  without committing it — so by the time activation for A/B/C finishes, the working tree is
  already dirty from Nevo's own bootstrap, before the reviewer does anything. D22's finish-time
  check (`HEAD == baseRevision`, dirty paths limited to the report) would then always fail for a
  correct batch. Can D22 be applied as originally written?
- **Decision:** No — corrected. `baseRevision = HEAD` is recorded **after** batch-start
  activation completes for every member, immediately before reviewer work begins (still no
  reviewer or product-code commit has happened at that point — only Nevo's own control-plane
  bootstrap mutation). Alongside `baseRevision`, `batch-start-and-context-bootstrap` also
  persists a **post-bootstrap tracked-state baseline** — a deterministic representation (e.g.
  content hashes per tracked file the bootstrap touched, or an equivalent fingerprint) proving
  what `change.yaml` (and any other file the bootstrap legitimately touched) looked like
  immediately after activation, before the reviewer's own session does anything. At batch-finish
  prevalidation (D21): `HEAD == baseRevision` still holds, **and** every tracked file except the
  canonical report must match this recorded post-bootstrap baseline exactly — not "the tree must
  be clean." The only tracked delta the reviewer's own session may ever produce is
  `reviews/review-batch-<batchExecutionId>.md`.
- **Rationale:** The reviewer must not be penalized for Nevo's own bootstrap dirtying
  `change.yaml` — the actual read-only invariant is "the reviewer changed nothing tracked except
  the report," which requires knowing what the tree looked like *after* bootstrap, not before.
- **Consequences:** `batch-start-and-context-bootstrap` persists the post-bootstrap baseline as
  part of its own durable record (D28); `batch-finish-operation`'s provenance check reads it
  instead of a literal pre-activation `HEAD`/clean-tree assumption.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `areas/batch-finish-operation.md`, `tasks/03-batch-start-and-context-bootstrap.md`,
  `tasks/04-batch-finish-operation.md` (D22's text is corrected in place by this decision)

## D30: Report-commit contract — explicit include, durable identity, no re-check after landing

- **Question:** D22 said the batch-finish operation "owns" the report commit, but didn't specify
  the commit's exact staging contract or its own crash-recovery identity. What stops it from
  absorbing `change.yaml`'s bootstrap dirt, another task's files, or double-committing on resume?
- **Decision:** The report commit stages **only** the exact canonical report path — an explicit
  `include` list containing exactly `reviews/review-batch-<batchExecutionId>.md`, never a
  default "stage everything" behavior. If `CommitAndPushAction` (or equivalent) is reused, it is
  invoked with that explicit include and with a context that tolerates the expected
  post-bootstrap `change.yaml` state (D29) without staging it. The report commit has its own
  durable identity (recorded SHA, completion flag) inside the batch-finish record (D28's sibling
  record family) — once recorded complete, crash recovery reuses that SHA and never re-commits.
  Critically: **once the report commit is recorded complete, resume never re-runs the original
  `HEAD == baseRevision` prevalidation check as though the operation had never started** — `HEAD`
  has legitimately advanced by the report commit itself. Recovery instead follows the batch
  record's own frozen per-stage state (report commit done → reuse SHA; task A's finish done →
  skip it; etc.), the same discipline D21 already established for per-task finishes.
- **Rationale:** An unscoped commit (`include: ['*']`) would nondeterministically absorb whatever
  else happens to be dirty at that instant — exactly the kind of provenance ambiguity D22 exists
  to prevent. A resume path that blindly re-checks the pre-report `HEAD` would falsely reject an
  otherwise-successful, already-partially-applied batch finish.
- **Consequences:** The batch-finish durable record's `validated`→`completed` progression (D21)
  gains an explicit report-commit stage with its own recorded SHA, ordered before the per-task
  apply stage (D22 already says "before or alongside").
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-finish-operation.md`, `tasks/04-batch-finish-operation.md`

## D31: Barrier enforcement lives in workflow-core, at real mutation boundaries — not projection

- **Question:** D17 requires the barrier to block automatic continuation, queue dispatch, human
  submission, and any other start/continuation path for a barriered member. The original task 06
  scope (`tools/specs/workflow/human-step/projection.mjs`, dashboard `reconciliation.mjs`) is a
  projection/UI boundary and dashboard-orchestration continuation path — it does not protect a
  direct call to `activateAndSubmitHumanStep` or the raw CLI's `workflow step start`. Can the
  barrier be enforced from there alone?
- **Decision:** No. The durable/read side of the barrier must be a **provider-neutral
  workflow-core primitive** — reusing the existing durable queue reservation itself (D9) as the
  canonical barrier state (per D36 below, avoiding a third membership copy) rather than a
  separate `batch-barrier.mjs` file. It exposes `isTaskBarriered(change, taskId)` (or
  equivalent), callable without importing `tools/dashboard/**`, and is consulted at the actual
  shared mutation/readiness boundaries: `ExecutionReadiness`/`assertExecutionReadiness`,
  `workflow step start`, `activateAndSubmitHumanStep`, and queue eligibility/dispatch (the queue
  evaluator already owns the reservation, so this is largely already colocated). Dashboard
  reconciliation and action projection may **also** surface the barrier for UI purposes, but they
  are not the correctness boundary — the workflow-core checks are.
- **Rationale:** A barrier enforced only at the dashboard/projection layer is bypassable by any
  direct domain call or raw CLI invocation — exactly the gap a "final" pass must close, not leave
  as a known hole.
- **Consequences:** `batch-queue-reservation` (task 02) gains ownership of wiring
  `isTaskBarriered` checks into the real workflow-core mutation entry points — **corrected by
  D37**: the actual public raw `workflow step start` entry point is `handleWorkflowStepStart` in
  `tools/specs/workflow/cli.mjs`, wired via a base-vs-ordinary split inside `readiness-policy.mjs`
  itself, never `step-runner.mjs` (which owns neither activation nor readiness here) — in
  addition to the queue evaluator it already owns — its scope is now "batch queue reservation
  **and action barrier**." `batch-completion-orchestration` (task 06) no longer owns a separate
  `batch-barrier.mjs` file; it owns *releasing* the reservation/barrier as part of its own
  ordering (D35), and may still touch `human-step/projection.mjs` for UI surfacing only.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-queue-reservation.md`,
  `tasks/02-batch-queue-reservation.md`, `areas/batch-completion-orchestration.md`,
  `tasks/06-batch-completion-orchestration.md`

## D32: One task owns the public `workflow batch start` composition — no two-stage BatchContext

- **Question:** The original graph had `batch-start-and-context-bootstrap` (03) return a "raw"
  `BatchContext`, with `batch-context-and-report` (05) later extending it with cross-task overlap
  and lineage — but 05 cannot wire itself back into 03's public operation, and 03 cannot depend
  on 05 without a cycle. A reviewer would receive an unowned, half-built intermediate context.
- **Decision:** Option B from the corrective review: **combine** raw-context construction and
  its cross-task/lineage extension into `batch-start-and-context-bootstrap` (03) — it is the one
  task that owns the public `workflow batch start` composition end to end and returns the final,
  complete `BatchContext` (shared/task-specific docs and files with `usedBy` attribution,
  per-member `StepContext`-derived contract, `crossTask` overlap attribution, per-member
  `predecessorSession` lineage, `batchExecutionId`, and the post-bootstrap baseline, D29). The
  former `batch-context-and-report` task (05) is renamed **`batch-report`** and narrows to
  exactly what its new name says: rendering the already-final `BatchContext` into the one
  canonical report file. It builds nothing — it consumes.
- **Rationale:** A composed artifact with no single owning operation is exactly the kind of
  "runtime pipeline with an unowned later extension" this pass exists to close. Folding
  construction and extension into the one task that already produces the per-member
  `StepContext`s removes the cycle without inventing a third task.
- **Consequences:** `areas/batch-context-and-report.md` → renamed `areas/batch-report.md`;
  `tasks/05-batch-context-and-report.md` → renamed `tasks/05-batch-report.md`; the change id
  `batch-context-and-report` → `batch-report` throughout `change.yaml` and every
  `depends_on`/`dependency_contracts` reference. `tools/specs/context/batch-context.mjs` (the
  `BatchContext` type/builder, including cross-task overlap detection and lineage resolution)
  moves into `batch-start-and-context-bootstrap`'s own allowed paths; `batch-report` owns only
  the report-rendering module/function.
- **Date:** 2026-09-28
- **Affected artifacts:** `overview.md`, `areas/batch-start-and-context-bootstrap.md`,
  `areas/batch-report.md` (renamed), `tasks/03-batch-start-and-context-bootstrap.md`,
  `tasks/05-batch-report.md` (renamed), `change.yaml`, D15/D25 (their mechanism is unchanged,
  only which task owns it)

## D33: Canonical admission/bootstrap sequence

- **Question:** The spec alternated between "`admitAgentExecution` triggers batch start" and
  "the reviewer session runs `workflow batch start`" without picking one. Which is authoritative?
- **Decision:** The sequence mirroring the established single-task protocol:
  reserve compatible batch (D9/D18) → the reservation is also the action barrier, active from
  here (D31) → `admitAgentExecution(scope: task-batch, batchExecutionId)` → create the canonical
  batch `AgentSession` plus every member's `SessionTaskBinding` (D24) → start the provider turn →
  inject a batch-specific Nevo workflow bootstrap message (not a step-name-derived prompt, same
  principle the sibling change's own generic-trigger decision already established) → the agent's
  own first required action is `workflow batch start ...` → that call's trusted ambient identity
  is validated (D23's model, applied at start) → the final `BatchContext` (D32) is returned →
  reviewer works → `workflow batch finish`.
  - `AgentSessionService` gains a batch-aware bootstrap path that does not depend on
    `activeTaskId` (a batch session has none, D2).
  - The batch prompt carries `batchExecutionId` as protocol context the agent's next tool call
    will reference — it is never treated as authority over persisted scope; the server always
    re-derives/validates scope from the durable reservation/session, never from prompt text.
  - The ordinary single-task bootstrap path is unchanged.
  - **No member is activated merely by session admission** — activation happens only when the
    agent itself calls `workflow batch start`, exactly mirroring how `workflow step start` is the
    single-task agent's own first action, never something admission does on the agent's behalf.
- **Rationale:** Matches the existing, proven single-task shape (admission creates the session;
  the agent's own first tool call does the activation) rather than inventing a different pattern
  for batches specifically, and removes the "does admission or the agent call batch-start"
  ambiguity outright.
- **Consequences:** `dashboard-batch-review-ux` (08) implements exactly this sequence for
  "review together"; `batch-start-and-context-bootstrap` (03) is confirmed as agent-invoked, not
  admission-invoked.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/dashboard-batch-review-ux.md`,
  `tasks/08-dashboard-batch-review-ux.md`, `areas/batch-start-and-context-bootstrap.md`

## D34: Context-capacity preflight happens before any member is activated (corrects D26; capacity-source wording corrected by D38)

- **Question:** D26 said the capacity preflight occurs before member activation, but the
  original task 03 text constructed authoritative `StepContext`s (which requires activation)
  first and only checked capacity before *returning*. A `BATCH_CONTEXT_TOO_LARGE` result must
  never leave A/B/C newly active — how is that actually achieved?
- **Decision:** Option A from the corrective review: add a **non-mutating prospective
  planning phase** before activation. Because the v1 batch case targets already-implemented
  tasks awaiting review, each member's prospective document/file set (the same inputs
  `StepContext` resolution would use — task definition, routing-derived docs, allowed paths) is
  statically derivable from already-approved task state and the workflow definition, without
  calling the mutating step-activation primitive. The planning phase computes the prospective
  `BatchContext`'s size from these read-only inputs and checks it against a capacity figure. If
  the prospective size would exceed that figure, the whole batch start fails with
  `BATCH_CONTEXT_TOO_LARGE` **before any member's step activation stage begins** — zero members
  are ever activated in this outcome. **Corrected by D38 below**: the capacity figure is not
  passed in as a live argument by the caller — it is frozen into the durable reservation's
  `executionConfigSnapshot` before the provider turn ever starts, and this planning phase reads
  that frozen snapshot (which may explicitly be `{status: "unknown"}`) rather than trusting
  anything a caller or a model-generated tool call could supply.
- **Rationale:** Rejecting after activation would violate D28's own "validate all before
  mutating any" discipline and leave A/B/C wrongly active with no reviewer following through.
  Keeping the capacity source out of workflow-core (whether framed as a passed-in number, per this
  entry's original text, or the frozen durable snapshot D38 corrects it to) preserves
  workflow-core's provider-neutrality either way.
- **Consequences:** `batch-start-and-context-bootstrap`'s sequence gains an explicit planning
  stage before its activation stage; `dashboard-batch-review-ux` resolves the capacity figure and
  freezes it into the reservation before starting a batch session (D38 — not passed as a live
  argument, as this entry originally described).
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `tasks/03-batch-start-and-context-bootstrap.md`, `areas/dashboard-batch-review-ux.md`

## D35: Batch Hook1 terminal ordering — claim release strictly before continuation dispatch

- **Question:** D16 said `batch-completion-orchestration` releases the barrier/reservation and
  dispatches continuations, but didn't define the exact ordering relative to releasing the
  workspace-writer claim. Could a refiner be dispatched while the batch's own claim is still held?
- **Decision:** Define and enforce this exact terminal ordering, after the provider turn reaches
  terminal, the batch-finish record reaches `completed`, and scope-aware settlement is proven
  (D19's model, applied at completion): (1) release the batch workspace-writer claim; (2) clear
  the `activeExecutions` batch record; (3) atomically release the action barrier/reservation
  (D31); (4) only then recompute and dispatch each member's next action, including admitting a
  fresh single-task refiner for any member whose result requires one. Dispatch never happens
  while the batch's own workspace-writer claim is still held — a refiner's own admission needs
  that slot free.
- **Rationale:** D33 (this change's own admission model) and D9 (single active execution) both
  depend on the workspace-writer slot being genuinely free before any new execution — including a
  refiner — can be admitted; an out-of-order release would either deadlock the refiner or violate
  the single-active-execution invariant if worked around.
- **Consequences:** A failed batch member's fresh refiner is admitted immediately after batch
  completion, with `parentSessionId` set to the batch reviewer session's id (D8/D25), and no
  stale batch claim causes workspace contention.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-completion-orchestration.md`,
  `tasks/06-batch-completion-orchestration.md`

## D36: No duplicated canonical batch membership across barrier/reservation records

- **Question:** With a separate barrier record (as originally drafted) plus the reservation plus
  `ExecutionScope`, batch membership risked three independently mutable copies. D31 folds the
  barrier into the reservation — does that fully resolve the duplication risk?
- **Decision:** Yes, with one remaining pair made explicit: the durable **reservation**
  (`batch-queue-reservation`, created first, also the barrier per D31) is the initial membership
  source at reservation time; `AgentSession.executionScope.taskIds` (D2) is set once, at session
  creation, by reading directly from that same reservation — it is never independently
  authored. Every operation that needs to confirm membership (batch-start, batch-finish) cross-
  checks that the reservation's `taskIds` and the session's `executionScope.taskIds` still agree,
  rather than trusting either one alone (the same discipline D23 already applies to
  `batchExecutionId`/reservation/claim agreement). Any other place a `taskIds` list might be
  persisted for query convenience is an explicitly validated **projection** of one of these two,
  never an independent authority.
- **Rationale:** `ExecutionScope` is the canonical *ownership* answer (D2); the reservation is
  the canonical *queue/barrier* answer (D9/D31) — two records with different jobs, not three
  copies of the same fact. Requiring cross-checked agreement rather than a single source removes
  the drift risk without collapsing them into one record that would conflate ownership with
  queue-scheduling state.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/execution-scope-model.md`, `areas/batch-queue-reservation.md`,
  `areas/batch-start-and-context-bootstrap.md`, `areas/batch-finish-operation.md`


## D37: The batch reservation blocks ordinary callers, not its own authenticated batch-start

- **Question:** D31 makes the reservation an action barrier and says a barriered member is not
  ready for ordinary execution. D33 then requires the already-admitted reviewer to call
  `workflow batch start`, which must re-check readiness and activate those same reserved
  members. Does the barrier therefore block its own batch?
- **Decision:** No. The readiness contract is split into two layers. A provider-neutral
  **base execution-readiness** evaluation owns workflow position, dependencies, suspensions,
  executor, prior-operation and clean-worktree preconditions, but does not interpret a batch
  reservation as an external blocker. The existing ordinary `ExecutionReadiness` surface wraps
  that base evaluation and additionally rejects any task for which `isTaskBarriered` is true.
  Raw/single-task `workflow step start`, direct human submission and queue dispatch continue to
  use the barrier-aware ordinary surface and remain blocked. `workflow batch start` is the only
  bootstrap path allowed to use base readiness for reserved members, and only **after** it has
  validated trusted ambient session identity, the live workspace claim, `batchExecutionId`,
  `ExecutionScope`, and exact reservation membership. It then invokes the same internal
  step-activation primitive ordinary step start uses; it does not invoke the ordinary
  barrier-aware CLI command N times.
- **No generic bypass:** there is no caller-supplied `ignoreBarrier`, `force`, or boolean escape
  hatch. The exception is structural: the authenticated batch-start operation owns exactly the
  reservation it is bootstrapping. It cannot activate a task outside that reservation, and batch
  Y cannot use batch X's reservation.
- **Boundary correction:** the public raw `workflow step start` entry point is
  `tools/specs/workflow/cli.mjs`; readiness lives in `readiness-policy.mjs`; the reusable
  mutation primitive is `ensureStepActivated()` in `step-context.mjs`. `step-runner.mjs`
  is not the public activation boundary and must not be named as if it were.
- **Rationale:** A barrier must prevent a second execution from stealing or advancing a batch
  member, not prevent the execution that owns the reservation from performing its required
  bootstrap.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-queue-reservation.md`,
  `areas/batch-start-and-context-bootstrap.md`, `tasks/02-batch-queue-reservation.md`,
  `tasks/03-batch-start-and-context-bootstrap.md`, `overview.md`

## D38: Execution configuration and context capacity are frozen in the reservation before the turn

- **Question:** D34 says dashboard code passes `maxContextTokens` into the later
  agent-authored `workflow batch start` call. But D33 says the dashboard does not make that
  call; the model does, after the provider turn has already started. Also, Claude/Antigravity
  model catalogs can legitimately have no authoritative `maxContextTokens`. What is the
  trusted data flow?
- **Decision:** Provider/model/mode selection happens before the reservation write. The atomic
  reservation freezes an immutable `executionConfigSnapshot` containing the selected provider,
  model and mode plus a context-capacity snapshot:
  - `{ status: "known", maxContextTokens, source }` when the selected model descriptor carries
    an authoritative/configured numeric value;
  - `{ status: "unknown", reason }` when the catalog does not know it.
  The later batch session/admission must agree with this frozen configuration. The batch bootstrap
  prompt carries only protocol context such as `batchExecutionId`; model-generated arguments
  cannot supply or enlarge the capacity. `workflow batch start` reads the snapshot from the
  durable reservation after trusted-identity validation.
- **Known-capacity preflight:** the non-mutating planner constructs the canonical prospective
  **text** batch-bootstrap payload using deterministic ordering and LF normalization. V1 uses
  `UTF8 byteLength(canonicalPayload)` as a deliberately conservative
  `estimatedContextTokensUpperBound` (one input token cannot represent less than one byte of
  that text payload). This is a Nevo safety estimate, not fabricated provider metadata and not a
  claim to reproduce the provider tokenizer. If that upper bound exceeds frozen
  `maxContextTokens`, fail with `BATCH_CONTEXT_TOO_LARGE` before any member activation.
  Passing this preflight is not a promise that provider/system overhead can never cause a later
  provider rejection.
- **Unknown-capacity policy:** do not invent a number and do not reject the batch solely because
  the trait is unknown. Persist/return `capacityStatus: "unknown"`, continue bootstrap, and
  surface an explicit UI warning that hard capacity preflight was unavailable. Therefore
  `BATCH_CONTEXT_TOO_LARGE` is produced only from a frozen known capacity.
- **Rationale:** The execution/model choice is owner-controlled configuration and must be frozen
  before model execution; the model itself cannot be trusted to declare its own budget. Unknown
  provider metadata must remain unknown rather than becoming guessed facts.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-queue-reservation.md`,
  `areas/batch-start-and-context-bootstrap.md`, `areas/dashboard-batch-review-ux.md`,
  `tasks/02-batch-queue-reservation.md`, `tasks/03-batch-start-and-context-bootstrap.md`,
  `tasks/08-dashboard-batch-review-ux.md`, `overview.md`

## D39: Post-bootstrap provenance freezes the complete repository-visible workspace delta

- **Question:** D29 suggested hashes of files the bootstrap touched. That proves bootstrap-owned
  files such as `change.yaml` did not change again, but does not prove the reviewer did not edit
  an unrelated tracked file or create an untracked source file. What must the baseline cover?
- **Decision:** After activation completes, batch start freezes `baseRevision = HEAD` plus an
  exact, deterministic **post-bootstrap workspace-delta fingerprint** relative to that revision.
  The fingerprint covers every repository-visible path outside `.nevo-ai-local/**` whose
  working-tree/index state differs from `baseRevision`, including staged/unstaged tracked
  modifications/deletions and untracked files. Entries are path-sorted and include status/mode
  plus a content hash where content exists. At finish prevalidation, with
  `HEAD == baseRevision`, recompute the same fingerprint while excluding only the one canonical
  batch report path; it must equal the frozen post-bootstrap fingerprint exactly. The report is
  the only reviewer-created repository-visible delta permitted.
- **Rationale:** Read-only means the reviewer changed no source/repository artifact, not merely
  that files Nevo itself touched still have the right hash. Comparing the complete delta also
  detects an unrelated modified documentation file or newly-created untracked source file.
- **Consequences:** D29's "tracked files bootstrap touched" example is superseded by this complete
  workspace-delta representation. D30's report-only staging contract is unchanged.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-start-and-context-bootstrap.md`,
  `areas/batch-finish-operation.md`, `areas/multi-task-review-skill.md`,
  `tasks/03-batch-start-and-context-bootstrap.md`, `tasks/04-batch-finish-operation.md`,
  `tasks/07-multi-task-review-skill.md`, `overview.md`

## D40: Batch completion is an idempotent staged settlement, not an atomic cross-store action

- **Question:** D35 defines claim release → `activeExecutions` clear → reservation release →
  dispatch, while the task text also says the sequence is "never partially applied." Those effects
  live in different durable/in-memory stores and cannot be one atomic transaction. What happens
  when the process crashes between them?
- **Decision:** Keep D35's ordering but implement it as a durable, idempotent completion-settlement
  saga keyed by `batchExecutionId` (for example
  `.nevo-ai-local/batch-completion/<change>/<batchExecutionId>.json`). Its ordered stages are:
  `claim-release`, `active-execution-clear`, `reservation-release`, per-member
  `continuation-dispatch`, then `completed`. On resume, each stage first derives authoritative
  current state; an effect that landed before its stage marker is treated as satisfied and is not
  blindly repeated. A different current owner/execution is never cleared as if it belonged to
  this batch.
- **Dispatch safety:** dispatch is illegal until authoritative checks prove the batch claim is
  gone, its `activeExecutions` entry is gone, and its reservation/barrier is released. Each
  member reuses the existing idempotent single-task continuation/admission mechanism. If a crash
  occurs after dispatch but before the settlement marker, reconciliation derives the already
  created/admitted continuation and records the stage rather than creating a duplicate.
- **Rationale:** Crash-safe partial progress is expected in a saga. Pretending the cross-store
  sequence is atomic would make the recovery contract impossible to implement honestly.
- **Date:** 2026-09-28
- **Affected artifacts:** `areas/batch-completion-orchestration.md`,
  `tasks/06-batch-completion-orchestration.md`, `overview.md`
