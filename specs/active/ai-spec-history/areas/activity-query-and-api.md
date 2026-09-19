# Area: Activity query and API

## Responsibility

Own the three required read scopes (task, spec-only, full spec history) over the per-spec
Activity store, and the read-only HTTP surface that exposes them, decoupled from
persistence.

## Current state

No query layer exists. The dashboard backend is Fastify with an enforced vertical-slice
convention (`app.mjs`'s `CAPABILITY_ROUTES_PATTERN`): a capability is a folder directly
under `tools/dashboard/server/` with its own `routes.mjs`, auto-loaded; query logic
typically lives in a sibling `data.mjs`/`service.mjs` (see `tools/dashboard/server/specs/`,
`tools/dashboard/server/pull-requests/`).

## Requirements

- `tools/specs/activity/query.mjs`: pure functions over the store area's read primitive —
  - task query: entries where `scope.specId` and `scope.taskId` match.
  - spec-only query: entries where `scope.specId` matches and `scope.taskId` is absent.
  - full-history query: all entries for `scope.specId`, unfiltered.
  - All three return entries in file append order (already deterministic — no sort step).
- `tools/dashboard/server/activity/routes.mjs` + `data.mjs`: read-only HTTP endpoints over
  `query.mjs`, following the existing capability convention (auto-loaded, no manual
  registration in `app.mjs`).
- JSON is the query/export format for this slice. The query module's output must be usable
  standalone (not dashboard-DTO-shaped) so a future CLI command or AI-context consumer can
  call it directly without going through HTTP.

## Constraints

- No persistence logic in `routes.mjs`/`data.mjs` — they call into `tools/specs/activity/
  query.mjs`, mirroring how `specs/data.mjs` and `pull-requests/service.mjs` separate HTTP
  wiring from logic.
- Do not couple the query module's return shape to any dashboard-specific DTO — see
  overview.md § Proposed architecture.

## Interfaces and boundaries

Consumes: the store area's read primitive (the per-spec NDJSON file) and its `Activity`
type.

Exposes: `queryTaskActivity(specId, taskId)`, `querySpecOnlyActivity(specId)`,
`queryFullSpecHistory(specId)`, and the HTTP endpoints wrapping them.

## Area-specific acceptance criteria

- Spec-level activity (no `taskId`) is returned by the full-history and spec-only queries,
  never by a task query.
- Task-scoped activity is returned by its task query and by the full-history query, never
  by the spec-only query.
- Full-history query output order is stable and matches file append order across repeated
  calls.
- The three query functions are callable directly (unit-testable) without starting the
  Fastify server.

## Dependencies

Depends on `areas/activity-model-and-store.md` (the store's read primitive and `Activity`
type).

## Out of scope

- Markdown export (deferred follow-up, see overview.md § Out of scope).
- Any UI/timeline rendering component — this area is the backend/query contract only.
