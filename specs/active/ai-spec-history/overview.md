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
- Human verification (`workflow verify-human --confirm`) persists a sign-off at
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

## Affected modules

- New: `tools/specs/activity/` (core model, store, actor resolver, query).
- New: `tools/dashboard/server/activity/` (read-only Fastify capability).
- Touched: `tools/specs/workflow/cli.mjs`, `tools/specs/workflow/finish-operation.mjs`
  (activity emission at the existing idempotent stage boundary).
- Touched: `tools/specs/workflow/human-verification-store.mjs` (activity emission on
  confirm).
- Touched: `tools/lib/git.mjs` (small addition: read local git user identity).
- New: `docs/decisions/ADR-00NN-local-append-only-activity-history.md`.

## Options and trade-offs

See `owner-decisions.md` D1 for the full three-option analysis (minimal / balanced /
target-shape unification with existing append-only stores). Decision: a fully separate
store — see Proposed architecture below.

## Owner decisions

See `owner-decisions.md` (D1–D9) for the full decision record. Summary: separate store
from diagnostics (D1), no pruning (D2), one NDJSON file per spec (D3), `git config` as the
v1 human-identity source (D4), `triggeredBy` references a prior activity id (D5), review
findings carry per-finding authorship in `data` rather than one activity per comment (D6),
namespaced per-producer types as the extensibility mechanism (D7), `type: architectural`
(D8), a new ADR is in scope (D9).

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

### Storage

- One append-only NDJSON file per spec: `.nevo-ai-local/activity/<specId>.ndjson`, keyed by
  the spec's stable `spec_id` UUID (survives change-slug renames).
- Append via a single write syscall per record (no read-modify-write) — no lock file is
  needed, unlike `binding-service.mjs`'s advisory lock, because pure appends don't race on
  shared mutable state the way read-modify-write does.
- Ordering is the physical line order in the file — no sort-by-`occurredAt` step, avoiding
  clock-skew/tie-break issues entirely (D3).
- No pruning (D2) — the file lives for the life of the spec (including after archival).
- Reader tolerates a trailing incomplete line (a crash mid-append): parses each line
  independently; an unparseable line is skipped, not fatal to the read.
- Fully separate module, schema, and directory from `lifecycle_traces` — no shared code
  with `trace-sink.mjs` (D1).

### Actor resolution

- `tools/specs/activity/actor-resolver.mjs`:
  - `user` actor: resolved from `git config user.name`/`user.email` (new small read added
    to `tools/lib/git.mjs`) at query/render time — not snapshotted into historical records
    (D4). Falls back to a placeholder id if git config is unavailable.
  - `agent-session` actor: the existing bound session id from
    `AgentSessionBindingService`.
  - `system` actor: a fixed constant (e.g. `{ type: 'system', id: 'nevo-workflow-engine' }`)
    for workflow-engine-initiated facts with no human/agent actor.
- Presentation (a rendered display name) is always resolved live from the actor's current
  source, never duplicated into the stored record — see Historical integrity below.

### Historical integrity

Stable identity refs are persisted; presentation is resolved later, live, and can change
without rewriting history. For v1, this has one accepted limitation: since there is
exactly one local human identity source (`git config`) and no multi-user registry, if the
git config identity later changes (different name/email), past activity records render
under the *current* name, not the name at the time of the action — there is no snapshot to
fall back to. This is acceptable for a single-machine local tool and is explicitly a v1
limitation to revisit if/when a real login/multi-user identity source replaces the git
config fallback (D4). Execution facts that matter historically regardless of presentation
(e.g. `result`, `attempt`, `transitioned_to`) are always stored as immutable event `data`,
never inferred from presentation state.

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

1. `workflow.step.started` — `handleWorkflowStepStart` (`cli.mjs`).
2. `workflow.step.completed` — `finishStep`'s transition stage
   (`finish-operation.mjs`), carrying `result`, `attempt`, `transitioned_to`, `artifacts`,
   `feedback`, and (when the review step already captures it) a `findings` list with
   per-finding `author` (D6).
3. `human.verification.confirmed` — `FileHumanVerificationStore.confirm()`
   (`human-verification-store.mjs`), actor resolved via the git-config-based user resolver.

### Idempotency for resumable operations

Activity emission for the workflow producer is wired into the **same idempotent
stage-transition guard** that already prevents `finishStep` from re-running
commit/push/transition on a resumed operation (`operation-record.mjs`'s per-stage
status tracking). A resumed/replayed finish does not re-emit `workflow.step.completed`
for a stage that already completed. As defense in depth, workflow-engine-emitted activity
ids are derived deterministically from stable identifiers (`operationId` + stage) rather
than freshly randomized, so an accidental double-call is still detectable/idempotent on
read without requiring the append-only store itself to deduplicate.

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
10. A resumed/replayed workflow finish operation does not create a duplicate
    `workflow.step.completed` activity for a stage that already completed.

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
- Consolidating the repo's existing duplicated atomic-write idiom
  (`operation-record.mjs`, `human-verification-store.mjs`, `binding-service.mjs`) — left
  as-is (D1).
