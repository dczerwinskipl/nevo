---
id: activity-local-store
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-model-and-store.md
    - specs/active/ai-spec-history/owner-decisions.md
    - tools/specs/activity/model.mjs
    - tools/specs/workflow/operation-record.mjs
allowed_paths:
  - tools/specs/activity/store.mjs
  - tools/tests/activity-store.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D1, D2, D3, D10]
  dependency_contracts: [activity-core-model-and-contracts]
---

# Task: Activity local append-only store

## Dependencies

`activity-core-model-and-contracts` (uses `model.mjs`'s envelope validator).

## Goal

Implement the local, append-only, per-spec NDJSON store for Activity records, and the
`recordActivity()` helper producers call.

## Requirements

- File path: `.nevo-ai-local/activity/<specId>.ndjson`, where `<specId>` is the change's
  stable `spec_id` UUID (not the slug) — resolve it the same way other `.nevo-ai-local`
  stores key by spec (see `tools/specs/identity.mjs`).
- **Construction order is fixed (2026-09-16 review, Major 4 — do not reorder):**
  `recordActivity(fields)` must (1) normalize/default the full envelope — `id ?? fields.id
  ?? crypto.randomUUID()` (i.e. use a caller-supplied `id` when given, only generate one
  otherwise), `occurredAt ?? new Date().toISOString()`, `schemaVersion ??
  ACTIVITY_SCHEMA_VERSION` (imported from `model.mjs` — this task owns applying the
  default, task 01's `model.mjs` owns defining the constant); (2) **then** validate the
  now-complete envelope via `model.mjs`'s `validateActivityEnvelope`; (3) **then** append.
  `validateActivityEnvelope` itself must never be handed a partial envelope by this
  module.
- **Framing (2026-09-16 review, Major 5 — replaces a trailing-newline-only design that
  cannot recover from a crash safely):** each record is written as `"\n" +
  JSON.stringify(record)` — a **leading** newline. A single write call per record, no
  read-modify-write, no lock file (D1's separate-store decision plus this store's
  pure-append nature make `binding-service.mjs`'s advisory lock unnecessary here —
  document why in a short code comment).
- `readActivities(specId)`: splits the file content on `\n`, discards empty strings
  (including the leading blank produced by the first record's leading newline), and skips
  any individual line that fails to JSON-parse — including a dangling partial line left by
  an interrupted write, which the leading-newline framing keeps isolated from the next
  valid record rather than merged with it. Returns records in file order.
- **Deduplication (2026-09-16 review, Blocking 2 — this is the load-bearing idempotency
  mechanism, see overview.md § Idempotency for resumable operations):** `readActivities`
  deduplicates the parsed records by `id`, keeping only the **first** occurrence (in file
  order) of each `id` and discarding later ones. Physical duplicate lines are never
  rewritten or removed from the file itself — dedup happens only in the read path's
  returned result.
- No pruning, no retention limit, no file-count cap (D2) — explicitly unlike
  `trace-sink.mjs`.
- If the file/directory doesn't exist yet, `readActivities` returns an empty list and
  `recordActivity` creates it.

## Implementation constraints

- Do not import from or structurally mirror `tools/dashboard/server/ai/diagnostics/
  trace-sink.mjs` — this is an intentionally separate module (D1).
- A caller-supplied `id` in `recordActivity(fields)` must be used as-is (never overridden
  or re-randomized) — producers rely on this for the deterministic-id scheme in
  overview.md § Idempotency.

## Acceptance criteria

- Appending N records and reading them back returns exactly N records in the order
  appended. `automated: node --test tools/tests/activity-store.test.mjs`
- A record appended for a spec is only visible when reading that spec's file — a second
  spec's file is untouched. `automated: node --test tools/tests/activity-store.test.mjs`
- `recordActivity` called with only the required fields (no `id`/`occurredAt`/
  `schemaVersion`) succeeds and the read-back record has all three populated.
  `automated: node --test tools/tests/activity-store.test.mjs`
- Simulating a crash that leaves a dangling partial line (write a partial JSON fragment
  with **no** trailing newline directly to the file, bypassing `recordActivity`), then
  calling `recordActivity` again for a new valid record: reading returns all preceding
  complete records **and** the new valid record intact; the partial line is the only one
  skipped. `automated: node --test tools/tests/activity-store.test.mjs`
- Appending two records that share the same `id` (simulating a retried/resumed emission):
  reading returns exactly one record for that `id` — the first one appended.
  `automated: node --test tools/tests/activity-store.test.mjs`
- No file-count or record-count pruning occurs after writing many records (verifies D2).
  `automated: node --test tools/tests/activity-store.test.mjs`
- `initiatedBy`/`triggeredBy` fields survive an append+read round trip unchanged when
  present, and are absent (not `null`-padded) when not supplied.
  `automated: node --test tools/tests/activity-store.test.mjs`

## Verification

```bash
node --test tools/tests/activity-store.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Actor resolution (task 03), query filtering by task/spec-only/full-history (task 04),
wiring any real producer (tasks 06–07).
