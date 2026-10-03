---
id: session-visibility-on-creation
status: draft
change: deterministic-flow-hardening-pt3
context:
  required:
    - specs/active/deterministic-flow-hardening-pt3/overview.md
    - specs/active/deterministic-flow-hardening-pt3/owner-decisions.md
    - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
    - tools/dashboard/ui/features/agent-sessions/queries.ts
    - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
    - tools/dashboard/ui/features/agent-sessions/types.ts
    - tools/dashboard/tests/agent-session-screen-navigation.test.tsx
  optional:
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/sessions/turns/routes.mjs
    - tools/dashboard/server/ai/sessions/routes.mjs
semantic_references:
  decisions: [D2]
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/queries.ts
  - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
  - tools/dashboard/tests/agent-session-screen-navigation.test.tsx
forbidden_paths:
  - src/**
  - tools/dashboard/server/**
---

# Task: Session visibility on creation

## Goal

Eliminate the "Sesja nie znaleziona" race after a session is created/admitted, by
using the data the creation response already carries instead of waiting on a single
retry against the separately-cached sessions list (D2, `owner-decisions.md`).

Current behavior (evidence, do not re-derive — see `owner-decisions.md` D2 for full
citations):
- `useCreateAgentSession` (`queries.ts:78-106`) receives the full created `session`
  object from `POST /api/agent-sessions`, but its `onSuccess` only calls
  `invalidateQueries` — it never seeds the list-query cache with the session it
  already has.
- `proceedWithAgentExecution` (`specification-detail-content.tsx:143-197`) gets only
  `{ sessionId, ownerId, turnId }` from `POST /api/agent-sessions/turns` (201), never
  invalidates the sessions-list cache at all, and navigates immediately on success.
- `AgentSessionScreen` (`agent-session-screen.tsx:89-117`) resolves the session purely
  from the cached list query, with exactly one bounded retry before permanently
  rendering "Sesja nie znaleziona" (no further automatic retry, no fetch-by-id).

## Requirements

- `useCreateAgentSession`: on success, seed the `AGENT_SESSIONS_QUERY_KEY` cache with
  the returned `session` directly (`queryClient.setQueryData`, prepending/merging by
  `sessionId`) in addition to (or instead of, if redundant) invalidating — the screen
  must see the real, complete session immediately, with no network round-trip needed.
- `proceedWithAgentExecution`: after a successful `/turns` admission, construct a
  minimal placeholder `AgentSession` record from data already known client-side (the
  response's `sessionId`, and the request's own `provider`/`mode`/`model`/`taskId`/
  `specId` — no new server fields required) and seed the same cache with it before
  navigating. Reuse an existing `AgentSessionStatus` value (e.g. `'running'`) for the
  placeholder — do not add a new enum case without flagging it as a new decision first.
- `AgentSessionScreen`: when the session is still not resolvable from the list cache
  (covers both a stale cache racing a real session, and a genuinely bad id), fetch it
  directly by id (`GET /api/agent-sessions/:sessionId`, already implemented server-side)
  as the authoritative check — not just another refetch of the same list query. Render
  "Sesja nie znaleziona" only once that direct fetch confirms a 404; a transport/5xx
  failure on that fetch must surface as a retryable error, not a false "not found"
  (mirror the existing `missingSessionRetryFailed` distinction).
- Both creation paths must leave the screen able to immediately render *something*
  useful (even a "starting" placeholder) rather than a loading spinner racing a cache
  miss.

## Implementation constraints

- No change to `GET /api/agent-sessions/:sessionId`'s response shape or to any server
  file (forbidden path) — reuse it as-is.
- Do not widen `AgentSessionStatus` or any other shared type without flagging it back
  as a new decision rather than deciding it unilaterally.

## Acceptance criteria

- After `useCreateAgentSession`'s mutation resolves, the sessions-list cache contains
  the new session without requiring any further network request.
  `automated: npm --prefix tools/dashboard run test:ui-stable`
- After a successful `/turns` admission and navigation, `AgentSessionScreen` renders
  session content (not "Sesja nie znaleziona" and not an indefinite loading state) even
  when the list query has not yet been refetched.
  `automated: npm --prefix tools/dashboard run test:ui-stable`
- A sessionId that the server genuinely does not have still resolves to "Sesja nie
  znaleziona" after the direct by-id fetch confirms 404 (no infinite retry, no false
  positive from the removed list-retry alone).
  `automated: npm --prefix tools/dashboard run test:ui-stable`
- A network/5xx failure on the by-id fetch surfaces as a retryable error state, not
  "Sesja nie znaleziona".
  `automated: npm --prefix tools/dashboard run test:ui-stable`

## Verification

```bash
npm --prefix tools/dashboard run test:ui-stable
node tools/specs.mjs validate
```

## Out of scope

Provider-quota UX (D1), the execution-policy provider selector bug (D3, task 02), and
any change to `POST /api/agent-sessions/turns`'s response shape.
