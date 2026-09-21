# Owner decisions — ai-spec-history

## D1: Storage location and scope of the Activity history

- **Question:** Should the new Activity history reuse/extend the existing `LifecycleTraceSink` (`.nevo-ai-local/lifecycle_traces/`, append-only NDJSON diagnostic trace), or be a fully separate store?
- **Options considered:** (1) minimal — new NDJSON store per spec mirroring the trace-sink pattern, own module; (2) balanced — same, plus extract a shared low-level atomic-append helper for future reuse by other stores; (3) target shape — unify trace-sink, human-verification-store, and operation-record onto one generic append-log service now.
- **Decision:** Fully separate store, own module, own schema, own directory. Do not mix with the raw/diagnostic response log — that is a distinct concern with its own future home. No code/schema sharing with `LifecycleTraceSink`.
- **Rationale:** Activity is a user-friendly history (source for a human-readable timeline), not a raw diagnostic log. Mixing the two concerns would couple a presentation-facing model to a pruned, diagnostics-shaped one.
- **Consequences:** New module `tools/specs/activity/` with its own NDJSON files under `.nevo-ai-local/activity/`; no dependency on `tools/dashboard/server/ai/diagnostics/trace-sink.mjs`. The existing atomic-write duplication in the repo (`operation-record.mjs`, `human-verification-store.mjs`, `binding-service.mjs`) is left as-is — not in scope to consolidate.
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`, `tasks/02-activity-local-store.md`

## D2: Retention / pruning

- **Question:** Should Activity records ever be pruned (like `lifecycle_traces`, which prunes by file count)?
- **Decision:** No pruning. Activity is a permanent local history — it must remain readable for the life of the spec (including after archival), unlike diagnostic traces.
- **Rationale:** The history is meant to answer "what happened to this spec/task, ever" — pruning would silently break that guarantee.
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`, `tasks/02-activity-local-store.md`

## D3: Storage granularity

- **Question:** One NDJSON file per spec (with task-scoped entries carrying `scope.taskId`), one file per task, or another split?
- **Decision:** One append-only NDJSON file per spec, keyed by the spec's stable `spec_id` (UUID from `change.yaml`), containing both spec-level and task-level entries. Task/spec-only/full-history queries are filters over this one file.
- **Rationale:** Owner had no strong preference ("jakkolwiek"); one file per spec is the simplest option that still satisfies all three required query scopes without a multi-file merge/sort step, since physical append order already gives deterministic chronological order.
- **Consequences:** No merge-and-sort logic needed for "full history" — it's the unfiltered file. Ordering is guaranteed by append order, not by re-sorting on `occurredAt`.
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`, `areas/activity-query-and-api.md`

## D4: Human actor identity source for v1

- **Question:** Where does the `user` actor's identity come from, given no local Nevo identity configuration exists today (human-verification only records a `role` string, never a real identity)?
- **Options considered:** (a) new local, manually-set identity file in `.nevo-ai-local`; (b) derive from `git config user.name`/`user.email`; (c) stub/defer real user identity in v1.
- **Decision:** Option (b) — resolve the `user` actor from `git config user.name`/`user.email` at read time. No new configuration file or setup step. Explicitly framed as a stand-in: a future login/auth mechanism may replace this; until then, local git config is the fallback identity source.
- **Rationale:** Owner: "docelowo zrobimy może logowanie, albo bez logowania wtedy fallback do danych lokalnych" — local git config is the cheapest available "local data" today and requires no new setup mechanism.
- **Consequences:** Display name is resolved live from current git config, not snapshotted per activity record (see overview.md § Historical integrity for the accepted limitation this implies). `ActorRef.id` for a user actor is the git config email (stable-ish local identifier).
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`, `tasks/03-actor-resolver.md`

## D5: `initiatedBy` vs `triggeredBy` semantics

- **Question:** Confirm the distinct meaning of `initiatedBy` (origin of the execution chain) vs `triggeredBy` (immediate prior cause), and whether `triggeredBy` references an actor or a specific prior activity.
- **Decision:** Confirmed as specified in the original brief. `triggeredBy` references the **id of the specific prior Activity record** that caused this one (not an `ActorRef` directly) — from that referenced activity's own `actor` field, the immediate cause's identity is still recoverable, but the reference also allows full causal-chain reconstruction (activity → activity → activity), not just "some prior actor, which action unknown."
- **Rationale:** Owner's own example (user → prompt → agent X work → auto handover → agent Y work): for agent Y's activity, `initiatedBy` = user (origin of the whole chain), `triggeredBy` = the specific handover activity caused by agent X's completion — not "agent X" as a bare actor reference.
- **Consequences:** `triggeredBy: string` (activity id), optional. Both fields can be absent (not every activity has a traceable initiator or trigger).
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`

## D6: Review "finding/nit" attribution

- **Question:** How does the timeline represent "agent Y did review, nit by USER"? Separate activity per comment, or structured data on one review activity?
- **Decision:** One `workflow.step.completed` (step=review) activity carries the review's factual outcome in `data`, including a `findings`/comments array where each entry has its own `author` (`ActorRef`), when that data is available at the point of emission. No separate activity per individual comment in v1.
- **Rationale:** Keeps the first slice small; avoids inventing an activity-per-comment producer when the review step's existing data already carries what's needed for the common case.
- **Consequences:** The review producer only attaches per-finding authorship if the underlying command already captures it structurally at the finish boundary; wiring deeper per-finding capture into the review command itself (if not already present) is out of scope for the first slice — see overview.md § Out of scope.
- **Date:** 2026-09-16
- **Affected artifacts:** `tasks/06-workflow-step-activity-producer.md`

## D7: Extensibility mechanism for new activity types

- **Question:** How are new activity types (future: PR created, merge, handover, etc.) added without redesigning the core schema?
- **Decision:** Namespaced dot-separated `type` strings (e.g. `workflow.step.completed`), each owned and validated by its producer module. The core Activity store validates only the envelope (id, type, schemaVersion, occurredAt, actor, scope, optional initiatedBy/triggeredBy) and treats `data` as an opaque, producer-validated payload. Adding a new type means adding a new producer module with its own type constant and data contract — no change to the core store/schema.
- **Rationale:** Owner: "Generalnie chce miec extinsibility, kazdy moze dodac info do loga" — matches the brief's non-negotiable extensibility requirement.
- **Date:** 2026-09-16
- **Affected artifacts:** `areas/activity-model-and-store.md`, `tasks/01-activity-core-model-and-contracts.md`

## D8: `change.yaml` classification

- **Question:** Classify as `type: standard` (current skeleton) or `type: architectural`?
- **Decision:** `type: architectural`. Touches "Persistence ownership" (an `AGENTS.md` owner-approval gate), spans multiple areas of the codebase (workflow engine, dashboard server, new persistence module), and adds a new query/service boundary.
- **Date:** 2026-09-16
- **Affected artifacts:** `change.yaml`

## D9: New ADR

- **Question:** Does this change warrant a new ADR, given ADR-0003/0004/0006 previously rejected event-sourced/history-preserving ledgers for adjacent concerns (with the reasoning "git already tracks history")?
- **Decision:** Owner deferred this call ("maybe") to be resolved during drafting. Resolved: yes, add a short new ADR. It records a durable architectural distinction future changes need: the ADR-0004/0006 precedent applies to git-tracked artifacts (where git substitutes for history); `.nevo-ai-local` is git-ignored, so git captures nothing about runtime execution facts (actor, session, attempt) — this is why a local append-only ledger is not a repeat of the previously-rejected pattern.
- **Consequences:** New `docs/decisions/ADR-00NN-local-append-only-activity-history.md`, written as part of the last task in this change.
- **Date:** 2026-09-16
- **Affected artifacts:** `tasks/08-activity-adr-and-docs.md`

## D10: Idempotency mechanism (resolved from PR #52 review, Blocking 2/3)

- **Question:** The `ultrareview` posted on PR #52 found that "deterministic activity ids
  as defense in depth" was not an actual idempotency mechanism — `readActivities`/
  `query.mjs` didn't deduplicate, so a crash between the Activity append and the
  operation-record stage-status update could either duplicate or silently lose an
  activity. It also flagged that `workflow.step.started`'s producer had no defined
  behavior for `step start`'s intentional repeatability, and that task 06 had no defined
  contract for obtaining the bound agent-session's `sessionId` at all (`autoBindAgentSession`
  returns nothing today).
- **Decision:** Adopted the review's own suggested direction, made concrete: every
  producer-emitted activity in this slice uses a deterministic id (`` `${type}:${specId}:
  ${taskId}:${step}:${attempt}[:${gateId}]` ``); the store's read path deduplicates by
  `id`, keeping the first occurrence. `autoBindAgentSession` (`tools/specs.mjs`) now
  returns the `AgentExecutionContext` it already computes, so callers can source
  `sessionId` for the agent-session actor.
- **Rationale:** Append-at-least-once + read-side dedup preserves the no-lock,
  single-write-per-record design (D1/D3) without needing a read-modify-write or a lock
  file to make the append itself exactly-once. Returning the already-computed execution
  context from `autoBindAgentSession` is a non-breaking, minimal-diff fix.
- **Consequences:** `store.mjs` (task 02) and therefore every `query.mjs` function (task
  04) now dedup by `id`. `tools/specs.mjs`'s `autoBindAgentSession` signature gains a
  return value (task 06).
- **Date:** 2026-09-16
- **Affected artifacts:** `overview.md`, `areas/activity-model-and-store.md`,
  `areas/activity-producers-workflow-and-verification.md`, `tasks/02`, `tasks/04`,
  `tasks/06`.

## D11: `workflow.step.completed` hook point (resolved from PR #52 review, Blocking 1)

- **Question:** The review found the spec named `finishStep`'s `transition` stage as
  where `workflow.step.completed` is emitted, but `transition` is a later, runtime-only
  stage that runs after commit/push and does not write `workflow_progress.history[]` —
  `ensureUpdateTask` (the `update-task` stage) is what actually computes the transition
  target and writes that history entry.
- **Decision:** `workflow.step.completed` is emitted from the `update-task` stage, and its
  meaning is now explicit: "the authoritative workflow state transition was recorded,"
  not "the whole durable finish operation (incl. commit/push) settled." A distinct future
  event for full durable settlement is left as a documented non-goal, not built now.
- **Rationale:** This is what the spec always intended to claim (correspondence with
  `workflow_progress.history[]`) — the stage name was simply wrong. Fixing the name
  rather than redefining the semantic keeps `workflow.step.completed` aligned with what
  the spec's own acceptance criteria already claimed.
- **Consequences:** No scope change — a factual correction. `overview.md`,
  `areas/activity-producers-workflow-and-verification.md`, `tasks/06` updated
  accordingly.
- **Date:** 2026-09-16
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`.

## D12: Human-verification emission boundary (resolved from PR #52 review, Major 6)

- **Question:** Task 07 originally wired activity emission inside
  `FileHumanVerificationStore.confirm()`, but that store only knows repo root, change
  slug, task, attempt, and gate data — not the stable `spec_id` the Activity store keys
  on, nor anything about git identity.
- **Decision:** Emit from `handleWorkflowVerifyHuman`'s `--confirm` branch in `cli.mjs`,
  immediately after a successful `confirm()` call — the CLI handler already has the full
  `change` object (and `spec_id`) in scope.
- **Rationale:** Keeps `FileHumanVerificationStore` focused on signoff persistence only;
  the CLI handler is the actual user-action boundary and already resolves everything
  Activity emission needs.
- **Consequences:** `human-verification-store.mjs` is untouched by this change entirely;
  task 07's `allowed_paths` moved from that file to `cli.mjs`.
- **Date:** 2026-09-16
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/07-human-verification-activity-producer.md`.

## D13: `user` actor presentation model for v1 (resolved from PR #52 review, D4 follow-on)

- **Question:** The review noted that D4's "git config as `id`" choice is itself not a
  stable identity — if git config changes, the old persisted `id` can't be resolved back
  to a display name from current config, since there's no registry to look it up in.
- **Decision:** Presentation for `type: 'user'` actors in v1 does not attempt an id-keyed
  lookup at all — every `user` actor renders as "the current live git identity," because
  v1 has exactly one local human. The stored `id` remains a historical fact (useful if
  multi-user support is added later), not a presentation lookup key. No new local-party-id
  config file is introduced, consistent with D4's "no new setup mechanism" preference.
- **Rationale:** Sidesteps the identity-drift problem entirely for the realistic v1 case
  (one local user) without adding new persisted configuration, while being explicit that
  this is a v1-only simplification, not a general multi-user solution.
- **Consequences:** `overview.md` § Historical integrity and § Out of scope now state this
  explicitly, including that multi-user-capable identity resolution is future work.
- **Date:** 2026-09-16
- **Affected artifacts:** `overview.md`, `areas/activity-model-and-store.md`,
  `tasks/03-actor-resolver.md`.

## D14: `autoBindAgentSession` must return the canonical binding, not the raw execution context (resolved from PR #52 review round 2, Blocking)

- **Question:** D10's fix ("`autoBindAgentSession` returns `context`") was itself wrong.
  `readAgentExecutionContext()` can legitimately resolve only `{provider,
  providerSessionId}` with no canonical `sessionId` at all — it's `bindSessionSync()` that
  generates/resolves the canonical `sessionId` (`effectiveSessionId = sessionId ||
  randomUUID()`, or reuses an existing session's id on a provider+providerSessionId
  match). Returning the pre-bind `context` and reading `context?.sessionId` would
  misclassify a validly-bound, provider-native-only session as `SYSTEM_ACTOR`.
- **Decision:** `autoBindAgentSession` returns `bindSessionSync()`'s own result (which
  always carries a resolved `sessionId`) on a successful bind, and `null` on every
  no-op/early-return/error branch. Callers use `binding?.sessionId`, not
  `context?.sessionId`.
- **Rationale:** `bindSessionSync`'s return value is the only thing that's guaranteed to
  carry a canonical `sessionId` — the pre-bind context is not.
- **Consequences:** Supersedes D10's session-actor-contract text (not the deterministic-id/
  dedup mechanism, which stands). `tools/specs.mjs`, `cli.mjs` call sites, and task 06
  updated.
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`.

## D15: `workflow.step.completed` emission moved to the `finishStep` call site (resolved from PR #52 review round 2, Blocking)

- **Question:** Deterministic ids + read-side dedup (D10) close the *duplicate*-emission
  crash window but not the *missing*-emission one: `ensureUpdateTask` has its own recovery
  branch for "the `workflow_progress` write already happened in a prior crashed attempt,
  but the operation record's stage was never marked completed." That branch detects the
  write, marks the stage completed, and returns without redoing anything else. If
  emission were gated on which internal branch of `ensureUpdateTask` ran, a resume taking
  this recovery branch would never emit the activity at all — not a duplicate, a
  permanently missing event.
- **Decision:** Move `workflow.step.completed` emission out of `ensureUpdateTask` entirely,
  into `finishStep`'s own stage sequence, called unconditionally immediately after `await
  ensureUpdateTask(...)` returns — regardless of which internal branch executed. Combined
  with D10's deterministic id/dedup, this closes both the missing-event and
  duplicate-event gaps.
- **Rationale:** Emission needs to depend on "did this stage complete" (observable at the
  call site after any successful return), not on "which code path performed the write"
  (an internal implementation detail of `ensureUpdateTask` that the recovery path
  deliberately skips).
- **Consequences:** `data` for the emitted activity is now built from `record`'s
  `update-task` stage result and `record.resolvedInputs`, both already populated
  in-memory — no new disk read needed.
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`.

## D16: Actor attribution for direct `--approve`/`--request-changes` human decisions (resolved from PR #52 review round 2, Major)

- **Question:** `handleWorkflowVerifyHuman` has two decision paths: the legacy
  `--confirm` (task 07's original scope) and the primary `--approve`/`--request-changes`,
  which calls `finishStep()` directly without ever calling `autoBindAgentSession`. Task 06
  sources its actor only from the agent auto-bind path, so a step completed via
  `--approve`/`--request-changes` had no defined actor and would fall back to
  `SYSTEM_ACTOR` — misrepresenting a human decision as a system action.
- **Options considered:** (a) pass a resolved `user` actor through a new `finishStep`
  parameter for the direct-human path; (b) emit a dedicated `human-decision` activity type
  distinct from `workflow.step.completed`.
- **Decision:** Option (a). `finishStep` gains an optional `actor` parameter (`ActorRef`,
  defaults to `SYSTEM_ACTOR`). `handleWorkflowStepFinish` passes the agent-session actor;
  `handleWorkflowVerifyHuman`'s `--approve`/`--request-changes` branch passes
  `resolveUserActor()`. No new activity type.
- **Rationale:** Both paths ultimately complete the same kind of fact (a workflow step
  transition) through the same function (`finishStep`) — the only thing missing was who
  did it. A parameter is simpler than a parallel event type for the same underlying fact,
  and keeps `workflow.step.completed`'s meaning (D11) intact regardless of which caller
  triggered it.
- **Consequences:** `finishStep`'s signature grows by one optional field (task 06 owns
  defining it; task 07 depends on task 06 to use it for the direct-human path — new
  `depends_on` edge added in `change.yaml`).
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`, `tasks/07-human-verification-activity-producer.md`,
  `change.yaml`.

## D17: Actor is captured durably on the operation record, not re-read from each resume call (resolved from PR #52 review round 3, Blocking)

- **Question:** D16 gave `finishStep` an `actor` parameter, but the emission call site
  (D15) reads it fresh on every call — including a resumed one. Concrete failure: agent A
  starts a finish, the operation record is created, `setTaskWorkflowState` writes
  `workflow_progress`, the process dies before the Activity append; agent B (or no actor at
  all) resumes the same finish; `ensureUpdateTask` takes its recovery branch; the call site
  (D15) now emits `workflow.step.completed` — but using B's actor, misattributing A's state
  transition to B. Recovery is a continuation of the same durable operation, not a new one
  under a new actor.
- **Decision:** The actor is captured **once**, into the durable operation record, at
  `createOperationRecord` (the moment a *brand-new* record is created), from whichever
  `actor` `finishStep`'s first call for this operation was given. Every later call against
  the *same* record — genuine resumes — reads `record.actor`, ignoring whatever `actor`
  that later call happened to pass. This requires one explicit, additive exception to
  "must not change the operation record shape": a new `actor` field on the record, set
  once at creation.
- **Rationale:** The question `workflow.step.completed` answers is "who performed this
  step's state transition," which is a fact about the *operation*, not about whichever
  process happened to make the specific call that observed the transition had already
  landed. A per-call parameter conflates the two.
- **Consequences:** `operation-record.mjs` needs no code changes (it persists/reads the
  whole record as opaque JSON) — only `createOperationRecord` in `finish-operation.mjs`
  gains the field. D16's "defaults to `SYSTEM_ACTOR` when omitted" now applies at record
  creation only, not at every emission.
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`.

## D18: Retry a failed Activity append on every later already-completed `finish` call (resolved from PR #52 review round 3, Major)

- **Question:** `recordActivity` failures are non-blocking by design (the workflow
  operation must succeed even if Activity recording fails). D15 guarantees a retry
  opportunity while the operation is still resuming through its stage sequence — but once
  `record.status === 'completed'`, a later repeated `finish` call short-circuits through
  `planFinish`'s `already-completed`/`completed` handling *without* re-entering the stage
  sequence at all, so a failed original Activity append would get no further chance.
- **Options considered:** (a) explicitly declare Activity best-effort on storage failure,
  accepting permanent loss in this case; (b) also idempotently (re-)attempt the same
  `workflow.step.completed` emission at the already-completed short-circuits, using data
  and actor preserved on the operation record.
- **Decision:** Option (b). Both of `finishStep`'s already-settled short-circuit returns
  also (re-)attempt the same emission (same deterministic id, so already-recorded is a
  no-op) before returning.
- **Rationale:** This naturally follows from D17 — once the actor and all other needed
  data live durably on the operation record rather than only being available at the moment
  of the original call, retrying the same emission from that record at any later point is
  cheap and correct, and turns every subsequent `finish` call into a free additional retry
  opportunity instead of a dead end.
- **Consequences:** The "build envelope + resolve id + call `recordActivity`" logic is
  shared by three call sites (main sequence, `already-completed`, `completed`) via one
  helper. The only way an Activity is now permanently lost is if `finish` is never invoked
  again for that step/attempt at all — an inherent limit of an observational,
  non-source-of-truth history, not a new gap.
- **Date:** 2026-09-17
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`.

## D19: Alignment with generic-step architecture and first-class human workflow steps

- **Question:** How should Activity History producers align with the deterministic generic-step
  architecture and first-class human workflow steps? Specifically, how are human step starts
  and completions attributed across both CLI and dashboard HTTP transport without deriving
  behavior from literal step names or conflating first-class human steps with exit gates?
- **Decision:**
  1. **Generic steps:** Workflow steps have arbitrary names (`implementation`, `review`,
     `human-verification`, and future arbitrary steps like `discovery`, `hardening`).
     The step definition's `executor` (`agent` vs `human`) determines execution protocol;
     `StepContext` determines agent work. Activity History observes generic lifecycle
     events (`workflow.step.started`, `workflow.step.completed`) without branching on literal
     step names.
  2. **Executor-neutral `workflow.step.started`:** Emitted upon step activation across both
     executors:
     - Agent activation: `handleWorkflowStepStart` (`tools/specs/workflow/cli.mjs`) resolves
       `actor = { type: 'agent-session', id: binding.sessionId }` (or `SYSTEM_ACTOR`).
     - Human activation: `startHumanStep` (`tools/specs/workflow/human-step/operations.mjs`)
       resolves `actor = { type: 'user', id: gitEmailOrName }`.
     - Both emit `workflow.step.started` with deterministic id
       `` `workflow.step.started:${specId}:${taskId}:${step}:${attempt}` ``.
  3. **Shared domain boundary for human execution:**
     - Both CLI (`handleWorkflowVerifyHuman --approve/--request-changes`) and dashboard HTTP
       transport (`POST /api/specs/:slug/tasks/:taskId/workflow/human-step`) delegate directly
       to the shared domain operations `startHumanStep` and `submitHumanStepResult` in
       `tools/specs/workflow/human-step/operations.mjs`.
     - `startHumanStep` activates the step and emits `workflow.step.started` (`actor.type = 'user'`).
     - `submitHumanStepResult` resolves `resolveUserActor()` and passes `actor: userActor` into
       `finishStep({ ..., actor: userActor })`.
     - This guarantees that human actions originating from either CLI or dashboard HTTP transport
       are consistently attributed to `actor.type = 'user'` at the domain boundary, without
       duplicating activity emission in HTTP adapters and without misclassifying dashboard human
       actions as `SYSTEM_ACTOR`.
  4. **Durable finish boundary (`finishStep` in `tools/specs/workflow/finish-operation.mjs`):**
     - Emits `workflow.step.completed` immediately after `ensureUpdateTask` returns.
     - Operates under D17 (actor captured once on brand-new operation record in
       `createOperationRecord`; resumes cannot override it) and D18 (retry on already-completed
       short-circuits).
  5. **Clear separation of `HumanVerificationGate` vs `executor: human`:**
     - `HumanVerificationGate`: Blocking exit gate evaluated during finish on an arbitrary step.
       Confirmed explicitly via `workflow verify-human --confirm`, emitting
       `human.verification.confirmed` (actor: user). Owned by task 07.
     - `executor: human`: First-class workflow step. Started via `startHumanStep` and completed
       via `submitHumanStepResult` -> `finishStep`. Emits `workflow.step.started` and
       `workflow.step.completed` with `actor.type = 'user'`. Owned by task 06.
- **Rationale:** Aligns Activity producers with the single authoritative domain boundary pattern.
  Prevents step-name coupling, avoids duplicate emission logic across CLI and HTTP transport
  layers, and cleanly separates exit gate confirmation from first-class human step execution.
- **Date:** 2026-09-21
- **Affected artifacts:** `overview.md`, `areas/activity-producers-workflow-and-verification.md`,
  `tasks/06-workflow-step-activity-producer.md`, `tasks/07-human-verification-activity-producer.md`,
  `change.yaml`.

