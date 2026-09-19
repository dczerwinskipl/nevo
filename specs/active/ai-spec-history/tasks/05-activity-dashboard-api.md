---
id: ai-spec-history.activity-dashboard-api
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-query-and-api.md
    - tools/specs/activity/query.mjs
    - tools/dashboard/server/app.mjs
    - tools/dashboard/server/specs/routes.mjs
    - tools/dashboard/server/specs/data.mjs
allowed_paths:
  - tools/dashboard/server/activity/routes.mjs
  - tools/dashboard/server/activity/data.mjs
  - tools/dashboard/tests/activity-routes.test.mjs
forbidden_paths:
  - src/**
  - tools/specs/workflow/**
  - tools/dashboard/src/**
semantic_references:
  dependency_contracts: [activity-query-and-export]
---

# Task: Activity dashboard API

## Dependencies

`activity-query-and-export`.

## Goal

Expose the three Activity query scopes as read-only HTTP endpoints, following the existing
Fastify capability convention so the folder is auto-loaded without touching `app.mjs`.

## Requirements

- `tools/dashboard/server/activity/routes.mjs`: read-only GET endpoints for task activity,
  spec-only activity, and full spec history, mirroring the request/response shape
  conventions already used by `tools/dashboard/server/specs/routes.mjs`.
- `tools/dashboard/server/activity/data.mjs`: thin adapter calling
  `tools/specs/activity/query.mjs` — no persistence logic here.
- No write endpoints — this capability is read-only in this slice (producers write via
  their own execution boundaries, not via HTTP).

## Implementation constraints

Follow the existing capability pattern exactly (folder name = URL prefix, `routes.mjs` as
the sole entry point Fastify autoloads) — do not add manual registration to `app.mjs`.

## Acceptance criteria

- `GET` task-activity endpoint returns the same data `queryTaskActivity` would, for a spec
  with task-scoped entries. `automated: npm --prefix tools/dashboard test -- activity-routes`
- `GET` spec-only endpoint excludes task-scoped entries.
  `automated: npm --prefix tools/dashboard test -- activity-routes`
- `GET` full-history endpoint returns spec + task entries combined in deterministic order.
  `automated: npm --prefix tools/dashboard test -- activity-routes`
- The capability is reachable without any change to `app.mjs`
  (`inspection: confirm app.mjs has no new manual route registration`).

## Verification

```bash
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Any dashboard UI/timeline component, write endpoints, Markdown export.
