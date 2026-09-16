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
