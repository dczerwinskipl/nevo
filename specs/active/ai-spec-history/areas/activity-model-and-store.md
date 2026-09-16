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
  `scope` (required); `initiatedBy`, `triggeredBy`, `data` (optional). Validates envelope
  shape only — `data` is opaque to this layer.
- A `recordActivity(envelopeFields)` append helper that producers call once their own
  `data` payload is validated.
- Storage: `.nevo-ai-local/activity/<specId>.ndjson`, one append-only file per spec keyed
  by the stable `spec_id` UUID. No pruning (D2). No lock file required — a single
  `fs.appendFileSync`-style write per record is the sole mutation, so there is no
  read-modify-write race to guard against (unlike `binding-service.mjs`).
- Reader: parses line-by-line; a trailing incomplete line (crash mid-append) or an
  individually unparseable line is skipped, not fatal to the read.
- Actor resolver:
  - `user`: reads `git config user.name`/`user.email` (add a small sync/async reader to
    `tools/lib/git.mjs`, reusing its existing `execFile`/process-invocation pattern rather
    than spawning `git` ad hoc). Falls back to a fixed placeholder id if config is absent.
  - `agent-session`: wraps an existing bound session id (from
    `AgentSessionBindingService` / `readAgentExecutionContext`) into an `ActorRef`.
  - `system`: a fixed constant `ActorRef`.
  - Resolution is presentation-live (not snapshotted) — see overview.md § Historical
    integrity.

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
- Appending while a trailing partial line exists in the file (simulated crash) does not
  corrupt reads of the preceding complete lines.

## Dependencies

None — this is the foundation area; the other two areas depend on it.

## Out of scope

- Query filtering logic (task/spec-only/full-history) — owned by
  `areas/activity-query-and-api.md`.
- Wiring any specific producer (workflow, human verification) — owned by
  `areas/activity-producers-workflow-and-verification.md`.
- Any mechanism for a user to *set* their git identity.
