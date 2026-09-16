# Area: Activity model and store

## Responsibility

Own the core `Activity` envelope contract, the extensibility mechanism for producer-owned
`data` payloads, the local append-only NDJSON persistence, and actor resolution
(`user`/`agent-session`/`system`).

## Current state

No such abstraction exists. The closest pattern, `LifecycleTraceSink`
(`tools/dashboard/server/ai/diagnostics/trace-sink.mjs`), is a separate, pruned,
diagnostics-scoped NDJSON log and is explicitly not shared with or reused by this area
(owner decision D1). No local git-config reader exists in `tools/lib/git.mjs` today.

## Requirements

- Core envelope type/validator: `id`, `type`, `schemaVersion`, `occurredAt`, `actor`,
  `scope` (required); `initiatedBy`, `triggeredBy`, `data` (optional). Validates a
  **fully-normalized** envelope only — it never defaults or generates any field itself
  (see the construction-order note on `recordActivity` below; this was Major 4 in the
  2026-09-16 review — task 01's validator and task 02's append helper previously
  disagreed about which of them defaults `id`/`occurredAt`/`schemaVersion`).
- `recordActivity(fields)`: **normalizes/defaults the full envelope first** (`id ??`
  a caller-supplied deterministic id, else `crypto.randomUUID()`; `occurredAt ?? now`;
  `schemaVersion ?? ACTIVITY_SCHEMA_VERSION`, the constant `model.mjs` exports), **then**
  validates the complete envelope via `model.mjs`'s validator, **then** appends. Producers
  that need idempotent/resumable semantics pass their own deterministic `id` in `fields`
  (see Idempotency below); `recordActivity` never overrides a caller-supplied `id`.
- Storage: `.nevo-ai-local/activity/<specId>.ndjson`, one append-only file per spec keyed
  by the stable `spec_id` UUID. No pruning (D2). No lock file required — a single write
  call per record is the sole mutation, so there is no read-modify-write race to guard
  against (unlike `binding-service.mjs`).
- **Framing:** each record is written as a **leading** newline plus its JSON (`"\n" +
  JSON.stringify(record)`), not a trailing one — see overview.md § Storage for why this
  order is what makes recovery from a crash mid-write actually safe to append after
  (2026-09-16 review, Major 5: the original trailing-newline-only framing let a crash's
  dangling partial line silently absorb and destroy the *next* valid append too).
- Reader: splits on `\n`, discards empty lines, and skips any individual line that fails
  to parse — a dangling partial line from an interrupted write is isolated (not merged
  with a subsequent valid record) by the leading-newline framing above.
- **Deduplication on read, by `id`, keep-first occurrence** (earliest `occurredAt` for
  that id; later lines with the same id are discarded from query results, though they
  remain physically present in the file — this store never rewrites/compacts). This is
  the actual idempotency mechanism for producers using deterministic ids, not a
  defense-in-depth extra (2026-09-16 review, Blocking 2 — see overview.md § Idempotency
  for resumable operations for the full reasoning and the id-construction scheme).
- Actor resolver:
  - `user`: reads `git config user.name`/`user.email` (add a small sync/async reader to
    `tools/lib/git.mjs`, reusing its existing `execFile`/process-invocation pattern rather
    than spawning `git` ad hoc). Falls back to a fixed placeholder id if config is absent.
  - `agent-session`: wraps a session id into an `ActorRef`. That `sessionId` is supplied
    by the caller (the producers area resolves it from `autoBindAgentSession`'s now-
    returned execution context — see `areas/activity-producers-workflow-and-verification.md`)
    — this module does not itself reach into `AgentSessionBindingService`/
    `readAgentExecutionContext`.
  - `system`: a fixed constant `ActorRef`.
  - Presentation for `user` actors is always "the current live git identity," with no
    id-keyed lookup, since v1 has exactly one local human — see overview.md § Historical
    integrity for why this is a deliberate v1-only simplification, not a general solution.

## Constraints

- Must not import from or depend on `tools/dashboard/server/ai/diagnostics/trace-sink.mjs`
  or its record format (D1).
- Must not require a new external dependency (ULID libraries, database drivers, etc.) —
  `crypto.randomUUID()` and plain NDJSON are sufficient.
- `data` validation is the producer's responsibility; this area must not hardcode a closed
  enum of activity types anywhere in the store or schema validator (D7, acceptance
  criterion 9).

## Interfaces and boundaries

Exposes: `recordActivity()`, the `Activity`/`ActorRef` types/validators, and
`resolveUserActor()`/`resolveAgentSessionActor()`/`SYSTEM_ACTOR`.

Consumed by: the query area (reads the same NDJSON files) and the producers area (calls
`recordActivity()` and the actor resolvers).

## Area-specific acceptance criteria

- `user`, `agent-session`, `system` actors round-trip through append + read unchanged.
- Actor presentation (a display name) is never written into a persisted record — only
  `{type, id}`.
- `initiatedBy` and `triggeredBy` persist independently; either, both, or neither may be
  present on a given record.
- A record with an unrecognized/new `type` string persists and reads back correctly
  without any change to the envelope validator (proves extensibility without a schema
  redesign).
- Simulating a crash that leaves a dangling partial line (no trailing newline, mid-JSON),
  then appending a further valid record: the valid record still reads back correctly and
  the partial line is skipped — not merged into the malformed line (proves the
  leading-newline framing actually recovers, not just that old complete lines survive).
- Appending two records with the same caller-supplied `id`: reading returns only one
  entry for that `id` (the first), proving read-side dedup.

## Dependencies

None — this is the foundation area; the other two areas depend on it.

## Out of scope

- Query filtering logic (task/spec-only/full-history) — owned by
  `areas/activity-query-and-api.md`.
- Wiring any specific producer (workflow, human verification) — owned by
  `areas/activity-producers-workflow-and-verification.md`.
- Any mechanism for a user to *set* their git identity.
