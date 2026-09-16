---
id: ai-spec-history.activity-local-store
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
  decisions: [D1, D2, D3]
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
- `recordActivity(fields)`: validates `fields` via `model.mjs`'s validator, assigns `id`
  (a fresh `crypto.randomUUID()` unless the caller supplies a deterministic id — see
  Implementation constraints), assigns `occurredAt` if not supplied, appends one JSON line
  + `\n` via a single write call. No read-modify-write, no lock file (D1's separate-store
  decision plus this store's pure-append nature make `binding-service.mjs`'s advisory
  lock unnecessary here — document why in a short code comment).
- `readActivities(specId)`: reads and parses the file line by line; a line that fails to
  parse (including a trailing incomplete line from an interrupted write) is skipped, not
  fatal to the rest of the read. Returns records in file order.
- No pruning, no retention limit, no file-count cap (D2) — explicitly unlike
  `trace-sink.mjs`.
- If the file/directory doesn't exist yet, `readActivities` returns an empty list and
  `recordActivity` creates it.

## Implementation constraints

- Do not import from or structurally mirror `tools/dashboard/server/ai/diagnostics/
  trace-sink.mjs` — this is an intentionally separate module (D1).
- Allow a caller to pass a pre-determined `id` into `recordActivity` (for producers that
  need deterministic ids for idempotency, per overview.md § Idempotency) — do not force
  every record onto server-generated random ids.

## Acceptance criteria

- Appending N records and reading them back returns exactly N records in the order
  appended. `automated: node --test tools/tests/activity-store.test.mjs`
- A record appended for a spec is only visible when reading that spec's file — a second
  spec's file is untouched. `automated: node --test tools/tests/activity-store.test.mjs`
- Simulating a truncated/partial trailing line in the NDJSON file: reading still returns
  all preceding complete records without throwing.
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
