---
id: ai-spec-history.activity-query-and-export
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-query-and-api.md
    - tools/specs/activity/store.mjs
    - tools/specs/activity/model.mjs
allowed_paths:
  - tools/specs/activity/query.mjs
  - tools/tests/activity-query.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D3]
  dependency_contracts: [activity-core-model-and-contracts, activity-local-store]
---

# Task: Activity query and export

## Dependencies

`activity-core-model-and-contracts`, `activity-local-store`.

## Goal

Implement the three required read scopes over a spec's Activity store, plus a JSON export
function, as a persistence-decoupled module usable by both the dashboard API (task 05) and
any future CLI/AI-context consumer.

## Requirements

- `tools/specs/activity/query.mjs`:
  - `queryTaskActivity(specId, taskId)` — entries where `scope.taskId === taskId`.
  - `querySpecOnlyActivity(specId)` — entries where `scope.taskId` is absent.
  - `queryFullSpecHistory(specId)` — all entries for `specId`, no filter.
  - `exportActivityAsJson(specId, { scope })` — returns the queried entries as a plain
    JSON-serializable array (the query result is already JSON-shaped; this is a thin,
    explicitly-named export entry point rather than a new format).
- All three query functions preserve file append order (already deterministic per the
  store) — no re-sorting by `occurredAt`.

## Implementation constraints

Do not shape return values around any dashboard DTO — this module must be callable from a
plain Node script without the dashboard server running.

## Acceptance criteria

- A spec with only spec-level activity (no task activity) returns that activity from
  `querySpecOnlyActivity` and `queryFullSpecHistory`, and an empty list from
  `queryTaskActivity` for any task id. `automated: node --test tools/tests/activity-query.test.mjs`
- A spec with both spec-level and task-level activity: `queryTaskActivity` returns only
  that task's entries; `querySpecOnlyActivity` excludes all task entries;
  `queryFullSpecHistory` returns both, interleaved in original append order.
  `automated: node --test tools/tests/activity-query.test.mjs`
- Calling any query function twice in a row on unchanged data returns identically ordered
  results (determinism). `automated: node --test tools/tests/activity-query.test.mjs`

## Verification

```bash
node --test tools/tests/activity-query.test.mjs
node tools/specs.mjs validate
```

## Out of scope

HTTP/Fastify wiring (task 05), Markdown export (deferred follow-up).
