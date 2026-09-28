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
- **Affected artifacts:** `areas/batch-context-and-report.md`, `tasks/05-batch-context-and-report.md`

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
- **Affected artifacts:** `areas/batch-context-and-report.md`, `tasks/05-batch-context-and-report.md`

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
- **Affected artifacts:** `areas/batch-context-and-report.md`

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
