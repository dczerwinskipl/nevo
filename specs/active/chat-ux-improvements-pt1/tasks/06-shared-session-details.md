---
id: chat-ux-improvements-pt1.shared-session-details
status: draft
change: chat-ux-improvements-pt1
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/lib/types.ts
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/ai/service.mjs
    - tools/ai/binding-service.mjs
    - tools/dashboard/server/ai-routes.mjs
    - tools/dashboard/package.json
    - tools/dashboard/tests/ai-server.test.mjs
  optional: []
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/src/components/ui/dialog.tsx
  - tools/dashboard/src/components/ui/sheet.tsx
  - tools/dashboard/src/components/session-details/**
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/lib/types.ts
  - tools/ai/service.mjs
  - tools/ai/binding-service.mjs
  - tools/dashboard/server/ai-routes.mjs
  - tools/dashboard/tests/**
  - tools/tests/agent-binding.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
---

# Task: Introduce shared Session details

## Goal

Move session context (specification, associated tasks, provider, mode) and secondary
actions (delete) out of persistent chrome into a Session details Sheet/Dialog, opened
from the header's `ⓘ` entry point (Task 05).

## D3 — new Sheet/Dialog dependency (decided, not blocked)

Add `@radix-ui/react-dialog` and build a Nevo-owned `Sheet`/`Dialog` primitive on top
of it (`tools/dashboard/src/components/ui/dialog.tsx`, `sheet.tsx`), per
`docs/development/react-component-guidelines.md` §2.2/§2.3/§3/§14/§25 — feature code
(`SessionDetails`) must consume the Nevo wrapper, never import
`@radix-ui/react-dialog` directly.

## D5 — session→task association display (decided: Option A)

A verification pass **refuted** the original premise that fixing this requires
migrating the binding record to an array-valued `taskIds[]`. What's actually true:

- `AgentSessionBindingService` (`tools/ai/binding-service.mjs`) **already** stores one
  row per task for a given `(provider, providerSessionId, specId)` —
  `bindSession`/`bindSessionSync` (`binding-service.mjs:252-331`, `:333-409`) push a
  new row when no exact match exists, and `listBindings`/`listBindingsSync`
  (`:453-462`, `:464-473`) already return the full multi-row array.
- `getBinding(provider, providerSessionId)` (`binding-service.mjs:475-480`) is what
  actually collapses this to one — a single `.find()` with no `specId`/`taskId`
  filter, returning only the first match. Neither `AiSessionService`
  (`tools/ai/service.mjs`) nor `tools/dashboard/server/ai-routes.mjs` ever aggregates
  multiple rows into one logical session; every consumer only calls `getBinding`.
- `AiSessionService.createSession` (`service.mjs:22`) derives a single `taskId` from
  `options.taskId` or a *single-element* `options.taskIds`; for `taskIds.length > 1`
  it sets no `taskId` at all — the bug is here and in the read-side aggregation gap,
  not in the storage shape.

**The aggregation must land in the actual HTTP route the dashboard consumes, not only
inside the service layer** — a fix that only lives in `AiSessionService`/
`bindingService` internals is not observable and does not close this task. Verified
concretely:
- The single-session route (`tools/dashboard/server/ai-routes.mjs:315-350` — the `GET`
  handler matching both `/api/agent-sessions/:provider/:providerSessionId` and the
  legacy `/api/ai/sessions/:provider/:providerSessionId` alias, which is the exact
  route `fetchAgentSessionSnapshot` in `nevo-assistant-runtime.ts` calls) builds its
  `session` response object with `taskId: binding?.taskId` — obtained via `await
  service.bindingService.getBinding(provider, providerSessionId)` directly — and never
  sets `taskIds` at all.
- `AiSessionService.listSessions` (`service.mjs:52-66`) does `bindings.map(binding =>
  ({ ...binding, ... }))` over the raw array `bindingService.listBindings(filters)`
  returns — one entry per binding *row*, not one per logical session. A session with 3
  task-bound rows currently surfaces as 3 separate list entries.

`owner-decisions.md` D5 records the final decision: **Option A — minimum change**.
Keep the existing normalized one-row-per-task persistence model; do not migrate
persisted binding records to a new array-valued `taskIds[]` schema.

Option B (migrate the binding record itself to a genuine `taskIds[]`, with the
redefinitions and migration that implies) was considered and rejected — see D5 for the
full trade-off analysis.

## D10 — cross-spec binding: aggregation must be spec-scoped (decided: Option C)

**The grouping key in D5's implementation must be `(provider, providerSessionId,
specId)`, not `(provider, providerSessionId)` alone.** A second verification pass
found the same provider session can legitimately hold binding rows under more than
one specification:

- Storage is partitioned per spec — one file per spec
  (`.nevo-ai-local/sessions/<specId>.json`).
- `bindSession`/`bindSessionSync` never check or replace a binding in a *different*
  spec's file — only the target spec's own file (`#loadForSpec(specId)`,
  `binding-service.mjs:265,346`).
- `autoBindAgentSession(change, taskId, purpose)` (`tools/specs.mjs:52-73`) is called
  from `requireChange`/`requireChangeAnywhere`/`requireTask` — i.e. from nearly every
  `tools/specs.mjs` command touching a change. A long-lived agent CLI session that
  runs commands against change A and later change B silently accumulates a binding
  row under both, with neither replacing the other. `agent-session attach` to a
  different spec for the same `providerSessionId` is a second, explicit path to the
  same outcome.
- `getBinding(provider, providerSessionId)` already copes with this today by loading
  *every* spec's file (`readdir`-ordered, not recency-ordered) and returning the
  first match — arbitrary, not merged, but still wrong in a different way.

Grouping by `(provider, providerSessionId)` alone — as D5 originally specified — would
take this pre-existing arbitrary-first-match bug and make it *worse*: instead of an
arbitrary single spec, it would merge task IDs from **unrelated specifications** into
one `taskIds[]`, contradicting the product model of "current specification + tasks
associated with that specification."

`owner-decisions.md` D10 records the final decision: **Option C — spec-scoped
aggregation, no deterministic-flow change.** Implement:

- `AiSessionService.createSession` calls `bindSession` once per task in
  `options.taskIds` (instead of collapsing to a single `taskId`) — unchanged from D5;
- the single-session GET route handler (`ai-routes.mjs:315-350`) determines the
  "current" spec **deterministically**: among all of a provider session's binding rows
  across every spec file, the one with the most recent `lastSeenAt` is current. It
  then reads via `listBindings`/`listBindingsSync` **filtered to that specific
  `specId`** (not all specs), groups those rows by `(provider, providerSessionId,
  specId)`, and sets `taskIds` on the response `session` object to that spec-scoped
  set only. `taskId`/`specId` on the response continue to reflect the chosen current
  binding; no field ever mixes task IDs from two specs;
- `AiSessionService.listSessions` groups `listBindings`' raw rows by `(provider,
  providerSessionId, specId)` — **not** `(provider, providerSessionId)` — into one
  logical session entry per group, each carrying the full `taskIds[]` for that
  spec-scoped group. A filter (e.g. `?specId=X&taskId=Y`) determines whether a logical
  session is *included* (does any row in its `(provider, providerSessionId, specId)`
  group match), not what its `taskIds[]` *contains* once included — the returned
  entry still carries every task in that same spec's group, not just the one that
  matched the filter. Because `listSessions`/`listBindings` are typically already
  called with a `specId` filter from spec-scoped dashboard views, this mainly matters
  for the *unfiltered* case and for the single-session route above;
- Options A (replace/move the current association at write time) and B (a separate
  explicit "current association" pointer) were considered and rejected — both require
  changing `bindSession`/`autoBindAgentSession`'s deterministic-flow write behavior;
  see D10 for the full trade-off table.

## D4 — no reassignment action (decided, not blocked)

Display the *current* specification association only; do not add an endpoint or UI
action to change it. `PATCH /api/agent-sessions/:provider/:providerSessionId` stays
scoped to `mode` — do not fold a reassignment capability in "while we're here."

## Implementation constraints

- Mobile: near-full-height/full-height Sheet, independently scrollable if needed, easy
  to dismiss, safe-area aware. Desktop: same content is acceptable for now (FR-15,
  explicitly deferred simplification) — do not design a separate desktop information
  architecture in this task.
- Structure: a Context section (specification, tasks, provider, mode) and a visually
  separated Actions section (delete) — destructive action must not sit next to
  informational content without visual separation.
- Manual task attach/detach is not introduced as a routine workflow (FR-16) — task
  association display stays derived from the correctly-aggregated `taskIds` data (per
  D5's Option A), not a new editable UI.
- Reuse the existing `window.confirm(...)` + `useDeleteAiSession()` delete flow
  (`ai-chat.tsx:207-215`) rather than inventing new cancellation/deletion backend
  behavior — only its presentation location moves.
- Accessible focus management, Escape-to-close, and keyboard navigation are owned by
  the Sheet/Dialog primitive itself (`docs/development/react-component-guidelines.md`
  §11), not reimplemented per-feature.
- Per `owner-decisions.md` D8: `ux-improvements-version-1`'s `task-session-linking`
  is a dependency/reuse item, not independent — coordinate with it (reuse its
  `taskIds`-driven linking logic for the associated-tasks list here) rather than
  building a second, parallel linking implementation. Its `ai-chat.tsx` header-
  metadata portion becomes moot once this task's Session details ships (that display
  moves here) — do not implement that portion of it separately.
- D5/D10 must not change `tools/specs.mjs start` → `autoBindAgentSession`'s existing
  behavior/semantics (`tools/specs.mjs:52-73,104`) — that call path binds one task at
  a time, to whichever spec it's given, and stays out of scope; it is exactly the
  deterministic-flow path D10's Option C was chosen to leave untouched. `getBinding`'s
  single-record contract stays unchanged for callers like `autoBindAgentSession` that
  genuinely want one row — only the session-assembly path (`AiSessionService`/
  `ai-routes.mjs`) switches to the spec-scoped aggregating read.
- Do not implement Option A or B from D10 (no replace-on-bind behavior in
  `bindSession`, no new "current association" field/pointer) — spec-scoping the
  existing read path is the entire fix.

## Acceptance criteria

1. `@radix-ui/react-dialog` is added to `tools/dashboard/package.json`; no other new
   general-purpose UI/component dependency is introduced.
   `inspection: diff package.json`
2. A Nevo-owned `Sheet`/`Dialog` primitive exists under `components/ui/`; feature code
   (`SessionDetails`) imports it, not `@radix-ui/react-dialog` directly.
   `inspection: grep for direct @radix-ui/react-dialog imports outside components/ui/`
3. The `ⓘ` entry point opens Session details.
   `automated: npm --prefix tools/dashboard test`
4. Mobile uses a substantial (near-full-height) drawer/sheet; desktop shows the same
   content (FR-15 — explicitly acceptable duplication for now).
   `inspection: render at mobile and desktop breakpoints`
5. Current specification is displayed.
   `automated: npm --prefix tools/dashboard test`
6. Associated NEvo tasks are displayed — including every task when a session has more
   than one associated task **within the same spec**, not just the first (D5's Option
   A, spec-scoped per D10).
   `automated: npm --prefix tools/dashboard test`
7. **HTTP-level proof, not just a service-layer/mock proof:** a session created with
   `taskIds.length > 1` (all within one spec) is returned with the complete
   `taskIds[]` from an actual `GET /api/agent-sessions/:provider/:providerSessionId`
   call against a running server — the same path the dashboard's
   `fetchAgentSessionSnapshot` uses — not only verified at the
   `AgentSessionBindingService`/`AiSessionService` layer or in a UI mock.
   `automated: npm --prefix tools/dashboard test` (extend `tools/dashboard/tests/ai-server.test.mjs`, e.g. the existing session-details assertion around line 119, or add a new case)
8. **List-session filtering does not truncate.** A session with multiple task-bound
   rows in one spec, listed via `GET /api/agent-sessions?specId=<spec>&taskId=<one-of-its-tasks>`,
   is included (filter determines inclusion) and its returned entry still carries the
   session's full spec-scoped `taskIds[]` (aggregation determines the full
   representation) — not just the task that matched the filter.
   `automated: npm --prefix tools/dashboard test`
9. **Cross-spec regression (D10) — the required new fixture.** The same
   `(provider, providerSessionId)` bound under **two different specs** (e.g. spec A
   with tasks A1/A2, spec B with task B1 — exactly the `owner-decisions.md` D10
   example) never produces a merged `taskIds[]` in either the single-session route or
   the list route: fetching the session returns only the current spec's own tasks
   (e.g. `[A1, A2]`, not `[A1, A2, B1]`), and the "current" spec is the one with the
   most recent `lastSeenAt`, not directory-listing order.
   `automated: npm --prefix tools/dashboard test`
10. `getBinding`'s existing single-record callers (e.g. `autoBindAgentSession`) are
    unaffected by D5/D10 — verified by the existing binding test suite continuing to
    pass unmodified in its currently-covered scenarios.
    `automated: node --test tools/tests/agent-binding.test.mjs`
11. Provider and mode are displayed where available.
    `inspection: open Session details for a session with a known provider/mode`
12. Delete is available and visually separated as destructive.
    `inspection: confirm delete sits in a visually distinct Actions area`
13. No new endpoint or UI action to change a session's associated specification is
    introduced (D4 boundary).
    `inspection: confirm ai-routes.mjs gains no new specId-mutation route from this task`
14. Manual task attach/detach is not introduced as a routine workflow.
    `inspection: confirm the tasks list in Session details is read-only`
15. Focus/dismiss behavior is accessible (focus trap while open, Escape closes, focus
    restored to the trigger on close).
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
node --test tools/tests/agent-binding.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Changing which specification a session is associated with (FR-17's reassignment
  action) — deferred to Chat Capabilities per D4.
- A separate, simplified desktop information architecture — deferred per FR-15.
- General task attach/detach UI.
- Migrating the binding record's on-disk shape (D5's Option B — considered and
  rejected).
- Changing `bindSession`/`autoBindAgentSession` write behavior to enforce one current
  spec, or adding a new "current association" pointer/field (D10's Options A and
  B — considered and rejected).
- A long-lived chat surviving a move from one spec to another, or any reassignment UI
  — explicitly deferred to Chat Capabilities (D4, reaffirmed by D10).
