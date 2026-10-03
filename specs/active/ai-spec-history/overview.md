---
id: spec.ai-spec-history
type: change
title: "AI Spec History"
status: draft
change: ai-spec-history
---

# AI Spec History

## Context

Nevo's deterministic workflow engine, session binding, and human-verification paths each
already know facts about *what happened* (a step started/finished, who was bound as the
executing session, who confirmed a gate) at the moment they happen — but nothing durable
observes these facts as a coherent, chronological history. `change.yaml`'s
`workflow_progress.history[]` records step transitions only, with no actor/session/cause,
and is scoped to one task. There is no way today to answer "what happened to this spec,
across all its tasks, in order" for a human reading it, or for a future AI session picking
up a handover.

This change introduces that missing layer: an append-only `Activity` history, observational
only, that never becomes the workflow's source of truth.

## Current architecture

- The deterministic workflow executes generic, definition-driven steps where the step's
  `executor` property (`agent` vs `human`) determines execution protocol rather than literal
  step names (`StepContext` drives agent work).
- The deterministic workflow's authoritative execution boundary is `finishStep` in
  `tools/specs/workflow/finish-operation.mjs`, driving a fixed, resumable stage sequence
  (`verify-gates -> update-task -> commit -> push -> transition`) against a durable
  per-attempt operation record at
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<n>.json`
  (`tools/specs/workflow/operation-record.mjs`). At that boundary, the code already knows
  change slug, task id, step, attempt, result, transition target, and artifacts, and writes
  a step-transition summary into `change.yaml`'s `task.workflow_progress.history[]` via
  `setTaskWorkflowState` (`tools/specs/store.mjs`).
- Agent sessions are bound to spec/task context via `AgentSessionBindingService`
  (`tools/dashboard/server/ai/sessions/binding-service.mjs`), persisted one JSON file per
  spec at `.nevo-ai-local/sessions/<specId>.json`. The current actor is resolved from
  environment variables via `readAgentExecutionContext` (`binding-service.mjs`).
- Human workflow steps (`executor: human`) execute without creating AI execution sessions.
  Activation (`startHumanStep`) and decision submission (`submitHumanStepResult`) live in
  `tools/specs/workflow/human-step/operations.mjs`, serving as the shared domain boundary
  for both the CLI (`handleWorkflowVerifyHuman --approve/--request-changes`) and the
  dashboard HTTP transport (`POST /api/specs/:slug/tasks/:taskId/workflow/human-step`).
- Human exit verification gates (`HumanVerificationGate`, evaluated during finish of any
  arbitrary step) are distinct from first-class human steps: a gate sign-off is confirmed
  via `workflow verify-human --confirm` and persists a record at
  `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<n>/<gate>.json`
  (`tools/specs/workflow/human-verification-store.mjs`) — but only a configured `role`
  string (e.g. `'owner'`), never a real human identity. No production code reads
  `git config user.name`/`user.email` today.
- Non-git-tracked runtime state already lives under `.nevo-ai-local/` (git-ignored). The
  closest existing append-only pattern is `LifecycleTraceSink`
  (`tools/dashboard/server/ai/diagnostics/trace-sink.mjs`), an append-only, schema-versioned
  NDJSON log at `.nevo-ai-local/lifecycle_traces/<turnId>.ndjson` with atomic writes and
  file-count pruning — scoped to one AI turn's diagnostic events, pruned, and explicitly
  **not** reused here (see Owner decisions D1).
- The dashboard backend is Fastify with an enforced vertical-slice convention: each
  capability is a folder directly under `tools/dashboard/server/` with its own
  `routes.mjs`, auto-loaded (`app.mjs`); query logic is separated into a sibling
  `data.mjs`/`service.mjs`.
- Stable, referenceable IDs already exist for everything this model needs to key against:
  `spec_id` (UUID, `tools/specs/identity.mjs`), agent session id (UUID,
  `binding-service.mjs`), and workflow attempt (positive integer) / operation id (UUID,
  `finish-operation.mjs`).

## Problem

Nothing durably records **who** did **what**, **when**, on **whose behalf**, and **because
of what**, across a spec's lifetime. `workflow_progress.history[]` is step-transition-only,
scoped to one task, and carries no actor/initiator/cause. There is no way to reconstruct a
chronological, human-readable timeline of a spec's activity — across tasks — today.

## Constraints

- Must not turn the deterministic workflow into event sourcing: `change.yaml`'s
  `workflow_progress` remains the sole source of truth for workflow state. Activity is
  observational.
- Must not require committing runtime identity/session data into Git — persists under
  `.nevo-ai-local/`.
- Must not duplicate ADR-0003/0004/0006's previously-rejected event-sourced/history-ledger
  pattern in spirit without addressing why this case differs (see Owner decision D9 — new
  ADR planned).
- No authentication/authorization; no impersonation/delegation chains; no transcript
  parsing or heuristic reconstruction of activity from git diffs or session contents (see
  Out of scope).
- Finish operations are durable/resumable (`operation-record.mjs`) — activity recording
  must not break that resumability or create duplicate records on a resumed/replayed
  operation (Owner decision — acceptance criterion, see below).
- The durable operation record's shape stays stable with **one explicit, additive
  exception**: a new `actor` field, captured once at record creation (D17) — no other
  field, no stage semantics, and no change to how `operation-record.mjs` persists/reads
  records.

## Affected modules

- New: `tools/specs/activity/` (core model, store, actor resolver, query).
- New: `tools/dashboard/server/activity/` (read-only Fastify capability).
- Touched: `tools/specs.mjs` (`autoBindAgentSession` returns its canonical session
  binding), `tools/specs/workflow/cli.mjs`, `tools/specs/workflow/human-step/operations.mjs`
  (`startHumanStep` emits `workflow.step.started` for human steps; `submitHumanStepResult`
  propagates `user` actor to `finishStep`), `tools/specs/workflow/finish-operation.mjs`
  (`finishStep` accepts an `actor` parameter; activity emission at the finish sequence's
  `update-task` call site, unconditional on every call — see § Idempotency for resumable
  operations).
- **Not touched** (D12): `tools/specs/workflow/human-verification-store.mjs` — activity
  emission for the legacy `--confirm` path lives entirely in `cli.mjs`, not the store.
- **Not touched** (D19): `tools/dashboard/server/specs/human-step-transport.mjs` — human-step
  activity recording lives at the domain operations boundary (`operations.mjs`), which the
  transport already calls.
- Touched: `tools/lib/git.mjs` (small addition: read local git user identity).
- New: `docs/decisions/ADR-00NN-local-append-only-activity-history.md`.

## Options and trade-offs

See `owner-decisions.md` D1 for the full three-option analysis (minimal / balanced /
target-shape unification with existing append-only stores). Decision: a fully separate
store — see Proposed architecture below.

## Owner decisions

See `owner-decisions.md` (D1–D19) for the full decision record. Summary: separate store
from diagnostics (D1), no pruning (D2), one NDJSON file per spec (D3), `git config` as the
v1 human-identity source (D4), `triggeredBy` references a prior activity id (D5), review
findings carry per-finding authorship in `data` rather than one activity per comment (D6),
namespaced per-producer types as the extensibility mechanism (D7), `type: architectural`
(D8), a new ADR is in scope (D9); resolved from three PR #52 review passes: deterministic
ids + read-side dedup as the idempotency mechanism (D10), correct `update-task` hook point
(D11), human-verification emission boundary moved to `cli.mjs` (D12), v1 `user`
presentation model (D13), `autoBindAgentSession` returns its canonical session binding
(D14), emission moved to the `finishStep` call site so the recovery path can't silently
skip it (D15), explicit user-actor propagation for the direct human decision path (D16),
the actor is captured durably on the operation record at creation rather than re-read from
each resume call (D17), and a failed Activity append gets a further retry opportunity on
every later already-completed `finish` call (D18); aligned with deterministic-status
generic-step architecture, executor-neutral step started, domain-level human actor
propagation, and exit-gate vs human-step separation (D19).

## Proposed architecture

### Activity envelope (core, stable schema)

```ts
type ActorRef = { type: string; id: string }; // 'user' | 'agent-session' | 'system' | future

type Activity = {
  id: string;             // stable UUID v4 (or deterministically derived — see below)
  type: string;            // namespaced dot-type, e.g. "workflow.step.completed"
  schemaVersion: number;    // envelope version, currently 1
  occurredAt: string;       // ISO-8601 UTC
  actor: ActorRef;
  initiatedBy?: ActorRef;   // origin of the execution chain (D5)
  triggeredBy?: string;     // id of the prior Activity that directly caused this one (D5)
  scope: { specId: string; taskId?: string };
  data?: unknown;           // producer-owned, producer-validated; opaque to the core store
};
```

The core store/schema validates only the envelope fields above. `data` is validated by the
producer before calling the shared append helper — a new producer adds a new `type`
constant and its own data contract, never touching the core envelope (D7, acceptance
criterion 9).

`recordActivity(fields)`'s construction order is fixed and must not be reordered
*(2026-09-16 review, Major 4: task 01/02 previously disagreed on whether fields were
defaulted before or after validation)*: **normalize/default the full envelope, then
validate it, then append.** Concretely: `id ?? <caller-supplied deterministic id, else
crypto.randomUUID()>`, `occurredAt ?? new Date().toISOString()`, `schemaVersion ??
ACTIVITY_SCHEMA_VERSION` (the constant `model.mjs` exports — `store.mjs` owns applying the
default, `model.mjs` owns defining it), *then* `validateActivityEnvelope(fullyNormalized)`,
*then* append. `validateActivityEnvelope` itself never defaults anything — it only ever
receives an already-complete envelope.

### Storage

- One append-only NDJSON file per spec: `.nevo-ai-local/activity/<specId>.ndjson`, keyed by
  the spec's stable `spec_id` UUID (survives change-slug renames).
- Append via a single write syscall per record (no read-modify-write) — no lock file is
  needed, unlike `binding-service.mjs`'s advisory lock, because pure appends don't race on
  shared mutable state the way read-modify-write does.
- **Framing (revised 2026-09-16 in response to review Major 5):** each record is written
  as `"\n" + JSON.stringify(record)` — a **leading** newline, not a trailing one. This
  matters for crash recovery: if a write is interrupted mid-record, the file ends with a
  dangling partial line with no newline after it (e.g. `...\n{prev}\n{partial`). Because
  the *next* append always starts with its own `\n`, that next write produces
  `...\n{prev}\n{partial\n{next}` — splitting on `\n` now cleanly isolates `{partial` (an
  independently skippable malformed line) from `{next}` (fully intact and readable). A
  trailing-newline-only scheme cannot make this guarantee: the next append would
  concatenate directly onto the dangling partial line and corrupt it too. Readers split on
  `\n`, discard empty lines (including the leading blank produced by the very first
  record's leading newline), and skip any line that fails to parse.
- Ordering is the physical line order in the file — no sort-by-`occurredAt` step, avoiding
  clock-skew/tie-break issues entirely (D3).
- No pruning (D2) — the file lives for the life of the spec (including after archival).
- **Deduplication on read, by `id`, keep-first** — see § Idempotency for resumable
  operations below (2026-09-16 review, Blocking 2). This is load-bearing for producers
  that use deterministic ids, not merely a nice-to-have.
- Fully separate module, schema, and directory from `lifecycle_traces` — no shared code
  with `trace-sink.mjs` (D1).

### Actor resolution

- `tools/specs/activity/actor-resolver.mjs`:
  - `user` actor: resolved from `git config user.name`/`user.email` (new small read added
    to `tools/lib/git.mjs`) at the point of emission, and stored as `{type: 'user', id:
    <email or name>}`. Falls back to a placeholder id if git config is unavailable.
  - `agent-session` actor: wraps a session id into `{type: 'agent-session', id:
    sessionId}`. That `sessionId` comes from `autoBindAgentSession`'s returned **canonical
    session binding** — see Producers below for the exact contract (2026-09-17 review
    round 2, Blocking: the first fix, "return the raw `AgentExecutionContext` and use
    `context?.sessionId`," was itself wrong — `readAgentExecutionContext()` can
    legitimately resolve only `{provider, providerSessionId}` with no canonical
    `sessionId` at all; it's `bindSessionSync()` that generates/resolves the canonical
    `sessionId` — a session identified only by `provider`+`providerSessionId` would have
    been misclassified as `SYSTEM_ACTOR` under the first fix. Corrected:
    `autoBindAgentSession` (`tools/specs.mjs`) now returns `bindSessionSync()`'s own
    result — which always carries a resolved `sessionId` — instead of the pre-bind
    context). Falls back to `SYSTEM_ACTOR` when nothing was bound (no execution context at
    all, or binding failed/threw).
  - `system` actor: a fixed constant (e.g. `{ type: 'system', id: 'nevo-workflow-engine' }`)
    for workflow-engine-initiated facts with no human/agent actor.
- **v1 presentation model for `user` actors (resolved 2026-09-16, replaces the earlier
  "resolved live from the stored id" description — see Historical integrity):** since v1
  has exactly one local human identity source and no multi-user registry, presentation for
  *any* `type: 'user'` actor is simply "the current live `git config` name," independent of
  which `id` that specific record stored — there is no id-keyed lookup. The stored `id` is
  kept as a historical fact (useful if multi-user support is added later and old records
  need reinterpreting), not as a presentation lookup key.

### Historical integrity

Stable identity refs are persisted; presentation is resolved later. For `agent-session`
and `system` actors, presentation can legitimately be looked up by `id` later (sessions
and system actors are enumerable/stable). For `user` actors in v1, presentation does not
attempt an id-keyed lookup at all (see Actor resolution above) — it always renders as the
current git identity, because v1 has exactly one local human and no registry to look up a
different one. This sidesteps rather than solves general identity drift: if a future
version needs *multiple, distinguishable* human actors, replacing the git-config fallback
with a real local-party id (and an actual lookup) is required at that point — this is
explicitly a v1 limitation, not a durable guarantee. Execution facts that matter
historically regardless of presentation (e.g. `result`, `attempt`, `transitioned_to`) are
always stored as immutable event `data`, never inferred from presentation state.

### Query / service boundary

- `tools/specs/activity/query.mjs`: three read functions over the one per-spec file —
  task-scoped, spec-only (excludes entries with a `taskId`), full history (unfiltered,
  spec + all tasks, in file order).
- `tools/dashboard/server/activity/` (Fastify capability, `routes.mjs` + `data.mjs`):
  thin read-only HTTP layer over `query.mjs`, following the existing
  `specs/`/`pull-requests/` vertical-slice convention. No persistence logic in the
  dashboard layer — the same `query.mjs` module is usable from a future CLI command,
  AI context/handover, or diagnostics without depending on the dashboard.
- JSON is the only export format implemented now (the filtered query result is already
  JSON). Markdown export is a defined-but-deferred follow-up (see Out of scope).

### Producers (first, deliberately small slice)

1. `workflow.step.started` — executor-neutral step activation (D19).
   - Agent activation: `handleWorkflowStepStart` (`cli.mjs`). Actor: `agent-session`
     (from `autoBindAgentSession`'s returned canonical session binding, see Actor resolution
     above) or `SYSTEM_ACTOR`.
   - Human activation: `startHumanStep` (`tools/specs/workflow/human-step/operations.mjs`).
     Actor: `user` (from `resolveUserActor()` in `actor-resolver.mjs`).
     Because both CLI and dashboard HTTP transport activate human steps through
     `startHumanStep`, instrumenting this domain boundary records all human step starts
     without duplicating emission logic or creating an AI execution session.
2. `workflow.step.completed` — emitted from **`finishStep`'s main stage sequence in
   `finish-operation.mjs`, immediately after `await ensureUpdateTask(...)` returns** (not
   from inside `ensureUpdateTask` itself, and not from the later `transition` stage — see
   § Idempotency for resumable operations for why the call site matters, 2026-09-17 review
   round 2, Blocking). `update-task` is the stage that computes the transition target and
   writes `task.workflow_progress.history[]`; `transition`/`commit`/`push` are later,
   runtime-only stages. So `workflow.step.completed` means specifically: *the authoritative
   workflow state transition was recorded* — not "the whole finish operation (incl.
   commit/push) settled." `data` carries `result`, `attempt`, `transitioned_to`,
   `artifacts`, `feedback` (all already known at `update-task`, readable straight off the
   in-memory operation `record` — no re-read from disk needed), and — only when already
   present at this boundary — a `findings` list with per-finding `author` (D6). A later
   `workflow.step.settled`-shaped event covering full durable completion (post commit/push)
   is explicitly out of scope for v1 (see Out of scope).
   - **Actor capture and propagation (D16, D17, D19):** `finishStep` gains an optional
     `actor` parameter. The initial actor is passed by callers into `finishStep`:
     - Agent path: `handleWorkflowStepFinish` passes `actor = agentSessionActor`.
     - Human path: `submitHumanStepResult` in `tools/specs/workflow/human-step/operations.mjs`
       resolves `resolveUserActor()` and passes `actor = userActor`. Because both CLI
       (`handleWorkflowVerifyHuman --approve/--request-changes`) and dashboard HTTP transport
       (`POST /api/specs/:slug/tasks/:taskId/workflow/human-step`) delegate directly to
       `submitHumanStepResult`, all human step decisions carry `actor.type = 'user'` into
       `finishStep` without duplicating logic or attributing dashboard human actions to
       `SYSTEM_ACTOR`.
     - Durable capture (D17): `finishStep` captures this actor once into the durable
       operation record itself (`createOperationRecord`, before any stage runs). The emission
       call site reads `record.actor`, so resuming calls cannot replace it with another actor.
3. `human.verification.confirmed` — `handleWorkflowVerifyHuman`'s `--confirm` branch only
   (`cli.mjs`), immediately after a successful `FileHumanVerificationStore.confirm()` call
   for a blocking `HumanVerificationGate` — **not inside the store**
   (`FileHumanVerificationStore` only knows repo root/change slug/task/attempt/gate data,
   not the stable `spec_id` the Activity store keys on; the CLI handler already resolves
   the full `change` object). Actor resolved via `resolveUserActor()`.
   **Human workflow steps (`executor: human`) do not produce this event type** (D19):
   first-class human steps finish via `submitHumanStepResult` -> `finishStep` and produce
   `workflow.step.completed` with `actor.type = 'user'`. `human.verification.confirmed`
   remains dedicated exclusively to blocking exit gate signoffs.

### Idempotency for resumable operations

*(Revised 2026-09-17, review round 2, Blocking — round 1's fix closed the *duplicate*
case but not the *missing-event* case: `ensureUpdateTask` already has its own recovery
branch for "the authoritative `workflow_progress` write happened, but the operation
record's stage was never marked completed" — e.g. a crash right after
`setTaskWorkflowState` but before an Activity append. On resume, that recovery branch
detects the write already happened, marks the stage `completed`, and returns *without*
redoing anything else. If Activity emission had stayed conditional on which internal
branch of `ensureUpdateTask` executed, this resumed call would never reach it — not a
duplicate, a permanently missing event. The fix is about *where* emission is called, not
just *what id* it uses.)*

- **Emission call site (fixes the missing-event gap):** `workflow.step.completed` is
  emitted by the *caller* of `ensureUpdateTask` — `finishStep`'s main stage sequence in
  `finish-operation.mjs`, on the line immediately after `await
  ensureUpdateTask(record, ...)` — unconditionally, every time that call resolves
  successfully, regardless of whether `ensureUpdateTask` internally took the fresh-write
  path or the "write already happened" recovery path. Because `record`'s `update-task`
  stage has its `.result` (the transition target) populated by either path before
  `ensureUpdateTask` returns, and `record.resolvedInputs` (`result`/`artifacts`/
  `feedback`) is already on the in-memory operation record, the caller has everything it
  needs without re-reading anything from disk. `ensureUpdateTask`'s own `if
  (stage.status === 'completed') return;` guard still exists (it guards the *state write*,
  which is a separate concern) but no longer gates activity emission at all.
- **Deterministic id + read-side dedup (fixes the duplicate-event case, from round 1):**
  every producer-emitted activity in this slice uses a **deterministic id**, derived from
  stable identifiers already known at the point of emission — not `crypto.randomUUID()`.
  Concretely: `` `${type}:${specId}:${taskId}:${step}:${attempt}` `` (`human.verification.
  confirmed` additionally includes `:${gateId}`, since one step/attempt can have more than
  one gate). The store's read path (`readActivities` in `tools/specs/activity/store.mjs`,
  and therefore every `query.mjs` function built on it) **deduplicates by `id`, keeping
  the first occurrence in file order** for that id (not by `occurredAt` — this design
  deliberately never orders by timestamp, see § Storage) and discarding later lines with
  the same id. Append itself stays a single write call with no pre-read/lock — it is
  intentionally append-at-least-once; correctness comes from read-side dedup, not
  write-side prevention.
- Together: emission is now *unconditional on every successful call* (closing the
  missing-event gap) *and* safely repeatable (closing the duplicate-event gap) — the two
  fixes are complementary, not alternatives. This also directly covers
  `workflow.step.started`'s repeatability (`workflow step start` is intentionally
  re-callable while a step is active) — repeated calls for the same attempt produce the
  same deterministic id and dedup to a single logical activity.

**Actor durability for resumed operations (2026-09-17, review round 3, Blocking — D17).**
Round 2's fix closed *when* an event is missing, but not *who it's attributed to* when a
resume genuinely happens under a different actor. Concrete failure mode: agent A starts a
finish, the operation record is created, `setTaskWorkflowState` writes
`workflow_progress`, the process dies before the Activity append; agent B (or a plain
`SYSTEM_ACTOR` context, or the owner via a different CLI invocation) resumes the same
finish; `ensureUpdateTask` detects the write already happened and returns via its recovery
branch; the call site now emits `workflow.step.completed` per D15 — but if it used
*this resume call's* actor, the activity would say B did it, when the state transition was
actually A's doing. Recovery is a continuation of the *same* durable operation, not a new
one with a new actor.

- **Decision:** the actor is captured **once**, into the durable operation record itself,
  at `createOperationRecord` (the moment a fresh record is created — before any stage
  runs), from whatever `finishStep`'s `actor` parameter was on *that* first call. Every
  subsequent call against the *same* record (a genuine resume) reads `record.actor` — the
  originally-captured value — and ignores whatever `actor` the resuming call happened to
  pass. This is the one explicit exception to "must not change operation record shape"
  (D17 revises that constraint): the record gains one new additive field, `actor`
  (`ActorRef`, defaulted to `SYSTEM_ACTOR` if `finishStep` was called without one). No
  other field, no stage semantics, and no persistence format beyond this one addition
  changes.
- `loadOperationRecord`/`saveOperationRecord`/`findInFlightOperationRecord`
  (`operation-record.mjs`) need no code changes — they already persist/read the whole
  record as opaque JSON; adding a field to the object `finish-operation.mjs` constructs
  and passes to them is sufficient.

**Retrying a failed Activity append past "already-completed" (2026-09-17, review round 3,
Major — D18).** `recordActivity` failures are wrapped so they never fail or roll back the
underlying workflow operation (unchanged design choice) — but D15's fix only guarantees a
retry opportunity while the finish operation is still genuinely resuming through its stage
sequence. Once an operation reaches `record.status === 'completed'`, a later repeated
`finish` call short-circuits through `planFinish`'s `already-completed`/`completed` status
handling in `finishStep` *without* re-entering the stage sequence at all — so if the
original Activity append failed (e.g. a disk error) and the operation went on to complete
normally otherwise, there would be no further opportunity to record it.

- **Decision:** at both of `finishStep`'s already-settled short-circuit returns (`plan.
  status === 'already-completed'` and `plan.status === 'completed'`, both of which carry
  `plan.existingRecord`), also **idempotently (re-)attempt** the same
  `workflow.step.completed` emission — same deterministic id, built from
  `plan.existingRecord`'s own stored `actor`, `step`, `attempt`, `update-task` stage
  result, and `resolvedInputs`. If it was already successfully recorded, this is a no-op
  (dedup-on-read collapses it); if the original attempt failed, this is the retry that
  finally succeeds. Every later `finish` call against a completed operation becomes a free
  additional retry opportunity, rather than a dead end.
- This reuses the same emission helper as the main stage-sequence call site (D15), just
  invoked from two additional call sites, and requires no new activity type or new
  tracked failure state — "best-effort at the moment of first attempt, self-healing on
  every later already-completed call" is the accepted v1 behavior. The only way an
  Activity is permanently lost is if `finish` is never invoked again for that step/attempt
  at all — an inherent limit of an observational, non-source-of-truth history, not a new
  gap this fix introduces.

### Extensibility for future producers

Adding a new activity type (PR created, merge, handover, spec finalized, etc.) means:
adding a new namespaced `type` string, a small producer-owned data contract/validator, and
a call to the shared `recordActivity()` append helper at the authoritative point the fact
becomes known. No change to the core envelope, store, or query layer.

## Compatibility and migration

No existing data migrates — this is new, additive, local-only state. No existing behavior
changes; `workflow_progress` remains authoritative and unaffected.

## Areas

- `areas/activity-model-and-store.md` — core envelope contracts, extensibility mechanism,
  the local NDJSON append-only store, and the actor resolver.
- `areas/activity-query-and-api.md` — the query module (task / spec-only / full-history)
  and the read-only dashboard API surface, decoupled from persistence.
- `areas/activity-producers-workflow-and-verification.md` — wiring the three first-slice
  producers into their existing authoritative execution boundaries, including the
  idempotency guarantee.

## Change-wide acceptance criteria

1. `user`, `agent-session`, and `system` actors can all be represented and round-tripped
   through the store.
2. Actor presentation (display name) is not duplicated into every activity record — only
   stable `{type, id}` refs are persisted.
3. `initiatedBy` and `triggeredBy` are distinct, independently-settable fields, and both
   are optional.
4. Spec-level activity can exist with no `taskId` set.
5. A task-scoped query returns that task's activity.
6. A spec-only query excludes any activity that has a `taskId`.
7. A full-history query merges spec-level and all task-level activity in one
   deterministically ordered stream (file append order).
8. Workflow attempt/result facts (`attempt`, `result`, `transitioned_to`) are preserved in
   the recorded `workflow.step.completed` activity.
9. A new, unrelated activity type can be added by a new producer module without changing
   the core persisted Activity schema or the store/query modules.
10. A resumed/replayed workflow finish operation does not surface a duplicate
    `workflow.step.completed` activity when queried (collapsed by read-side dedup-by-`id`).
    Also proven: repeated `workflow step start` calls for the same attempt dedup to a
    single `workflow.step.started` activity.
11. Simulating the crash window described in § Idempotency for resumable operations —
    `workflow_progress.history[]` already written, the operation record's `update-task`
    stage still `pending`, and no `workflow.step.completed` activity recorded yet — a
    resumed `finishStep` call yields exactly **one** queryable `workflow.step.completed`
    activity (proves the missing-event gap is closed, not just the duplicate-event gap).
12. A human-owned workflow step completed via CLI (`--approve` / `--request-changes`)
    or via dashboard HTTP transport (`POST .../human-step` action `submit`) produces a
    `workflow.step.completed` activity with a `user`-type actor, never `SYSTEM_ACTOR`
    (proves direct human decisions are correctly attributed across both entry points).
13. Simulating the D17 crash scenario — actor A's `finishStep` call creates the operation
    record and gets as far as the `workflow_progress` write, then a *different* actor
    (actor B, or no actor at all) resumes the same finish — the resulting
    `workflow.step.completed` activity's actor is **A**, not B and not `SYSTEM_ACTOR`
    (proves the operation record's captured actor is durable and resume calls cannot
    override it).
14. Simulating a `recordActivity` failure on the first successful completion of a step,
    then calling `finish` again against the now-`completed` operation (an
    `already-completed`/`completed` short-circuit, not a resume through the stage
    sequence): the `workflow.step.completed` activity that failed to record the first
    time is now present when queried, with the original actor (proves D18's retry-on-
    already-completed closes the "Activity failed and got no further retry" gap).
15. A human-owned workflow step activated via `startHumanStep` (CLI or dashboard HTTP
    transport) produces a queryable `workflow.step.started` activity with a `user`-type
    actor.

## Verification strategy

- `node --test tools/tests/` for the new `tools/specs/activity/*` unit/integration tests
  and the updated workflow/human-verification producer tests.
- `npm --prefix tools/dashboard test` for the new `activity` capability's route tests.
- `node tools/specs.mjs validate` and `node tools/docs.mjs validate` after each task that
  touches specs/docs.

## ADR impact

New ADR: `docs/decisions/ADR-00NN-local-append-only-activity-history.md` — records why a
local, append-only, git-ignored activity ledger is not a repeat of the pattern
ADR-0003/0004/0006 rejected (those applied to git-tracked artifacts, where git substitutes
for history; `.nevo-ai-local` runtime facts have no such substitute), and records the
append-only/no-pruning/namespaced-extensibility design as the durable decision future
producers must follow (D9).

## Out of scope

- Any raw/diagnostic response or transcript log — that remains `lifecycle_traces` /
  transcript cache, a separate concern with its own future home (D1).
- Authentication, authorization, impersonation/delegation chains.
- A mechanism for a user to *set* their local identity (git config is read, not written,
  by this change) — if git config is absent, a placeholder actor id is used.
- Full handover functionality — only the Activity model's ability to *represent* a
  handover-shaped causal chain (`initiatedBy`/`triggeredBy`) is in scope, not an actual
  handover feature.
- Per-comment activity records for review findings — findings are carried as structured
  `data` on one `workflow.step.completed` activity (D6); wiring deeper per-finding capture
  into the review command itself, if not already present at the finish boundary, is a
  follow-up.
- Markdown export — JSON query/export only in this slice; Markdown export is a defined
  follow-up.
- Producers beyond the three listed above (PR lifecycle, merge, handover, spec
  create/finalize) — the model must support them without redesign, but wiring them is
  future work.
- A distinct event for the full durable finish operation settling (i.e. covering
  commit/push, after `workflow.step.completed`'s `update-task`-stage meaning) — a future
  `workflow.step.settled`-shaped type is possible without redesign, but not built now
  (2026-09-16 review, Blocking 1 follow-on).
- Multi-user-capable identity resolution (a real local-party id + id-keyed presentation
  lookup for `user` actors) — v1 renders every `user` actor as "the current git identity"
  with no lookup, since there is exactly one local human; see § Historical integrity.
- Consolidating the repo's existing duplicated atomic-write idiom
  (`operation-record.mjs`, `human-verification-store.mjs`, `binding-service.mjs`) — left
  as-is (D1).
