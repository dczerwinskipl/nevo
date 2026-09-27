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
  atomic transaction.**
  In git-backed repositories, member task finish operations (transitions, git commits, push)
  commit and push individually. If a crash occurs mid-batch, tasks finished before the crash may
  already have committed git history; a true atomic repository rollback across git and external
  remotes is impossible without dangerous force-pushes or complex compensating reverts.
  The execution sequence is:
  1. Record intent in a durable batch-finish record (`.nevo-ai-local/batch-finishes/<id>.json`) in
     state `pending`;
  2. Perform pre-condition validations (verdicts provided for all tasks, clean working tree,
     canonical report present);
  3. Execute individual task step completions sequentially and idempotently (updating per-task
     state in `change.yaml` and committing per-task artifacts);
  4. Once ALL member tasks are successfully finished, mark the batch-finish record `completed`;
  5. The continuation barrier ensures that NO downstream continuations or queue advancements are
     dispatched until the entire batch reaches `completed`;
  6. If interrupted/crashed mid-saga: recovery resumes from the durable record, finishing remaining
     tasks before releasing the barrier.
- **Rationale:** Guarantees crash-recoverability and prevents premature downstream continuations
  without attempting impossible cross-repository atomic transactions. Option 1 has no real
  crash-recovery story; Option 3 touches the core lifecycle-write path everything else depends on,
  for a benefit outside this change's scope.
- **Consequences:** A new durable batch-finish record family (mirrors the existing
  intent-then-derive convention `batch.json`/`follow-ups.yaml` already use).
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-finish-operation.md`, `tasks/03-batch-finish-operation.md`

## D4: Read-only reviewer capability profile for batched review

- **Question:** May a batch reviewer edit source files directly, or only inspect and report?
- **Options considered:** Read-only capability profile (inspect, report, assign verdicts/feedback; a
  failed task gets a fresh single-task refiner) | Writable profile (reviewer can fix directly, but
  raises attribution questions — which task owns the edit, which `allowed_paths` apply, whose
  provenance changes).
- **Decision:** Read-only capability profile for v1.
  - Batched review v1 is an explicit execution capability profile:
    - No source-file writes permitted;
    - Allowed writes are strictly limited to the canonical review report (`reviews/review-batch-<id>.md`)
      and the batch-finish mutation.
  - Single-task review retains its existing capability profile (including corrective edits where
    configured, e.g. `executeReviewWorkflowStep`). Do not conflate batch review's read-only profile
    with single-task review behavior.
  - Enforcement mechanisms:
    - Provider tool sandboxing where supported (e.g. read-only tool profile / no edit tools provided to
      the agent session);
    - Nevo control-plane post-condition verification: before accepting batch-finish, verify working
      tree has no uncommitted source changes and no git commits outside the permitted review artifact
      path; fail closed if violated.
  - A failing task proceeds through the existing single-task fresh refiner role unchanged.
- **Rationale:** Avoids multi-task file ownership, attribution, and merge provenance ambiguity across
  concurrent task scopes without weakening single-task review capabilities.
- **Consequences:** The batch reviewer session/skill is granted no write access to source paths for
  v1; only its own report file and the batch-finish call are writes. Attempted source edits fail closed.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/multi-task-review-skill.md`, `tasks/05-multi-task-review-skill.md`

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
  scope, but nothing in the runtime model enforces a number.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/dashboard-batch-review-ux.md`

## D7: Report structure

- **Question:** One shared report or one per task?
- **Decision:** One canonical shared batch report (`reviews/review-batch-<id>.md`) plus a durable
  per-task reference/anchor into it — never a full copy per task.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-context-and-report.md`, `tasks/04-batch-context-and-report.md`

## D8: Lineage representation and fail-closed resolution

- **Question:** How does a batch reviewer session record its relationship to each member task's
  own prior implementer session, given `parentSessionId` is a single scalar?
- **Decision:** Explicit per-task predecessor relation into the batch session — do not flatten N
  parents into one `parentSessionId` scalar.
- **Fail-closed lineage resolution semantics:**
  - For each member task, predecessor lineage is resolved as follows:
    1. Check if the task's current workflow step has an authoritative exact history binding (e.g. `history.sessionId` from the preceding implementer transition);
    2. If not, inspect `stepBindings` / durable session index for sessions bound to that task for the implementer step:
       - If exactly one active/completed implementer session exists for that task, use it;
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
  `parentSessionId` is the batch session's id — a genuinely singular predecessor).
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-context-and-report.md`, `tasks/04-batch-context-and-report.md`

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
  acceptance.
- **Date:** 2026-09-27
- **Affected artifacts:** `areas/batch-finish-operation.md`, `tasks/03-batch-finish-operation.md`

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
    3. That step defines `executor: agent` with the same authoritative role (e.g. `reviewer`);
    4. All tasks are individually eligible/runnable for that step (no pending prerequisites or unsatisfied gate conditions);
    5. All member tasks require `session: fresh` semantics for the batch session in v1. A batch review execution always runs in a fresh dedicated session — it never attaches to an existing single-task implementer session.
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
