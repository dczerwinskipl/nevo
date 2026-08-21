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

## Blocked on an open owner decision

The multi-task binding fix below (D5) cannot be implemented until
`owner-decisions.md` D5 is resolved with an explicit A or B answer — this task cannot
move past `draft` review to `approved` while D5 is open. The Sheet/Dialog primitive
work (D3) and the read-only display of specification/provider/mode/delete (independent
of D5) are not blocked and may proceed.

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

## D5 — session→task association display (open, choose per `owner-decisions.md` D5)

A second verification pass **refuted** the original premise that fixing this requires
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
  not (necessarily) in the storage shape.

Per `owner-decisions.md` D5, the recommended (but not yet decided) direction is
**Option A — minimum change**: call `bindSession` once per task in
`options.taskIds` from `createSession` instead of collapsing to a single `taskId`, and
add aggregation at the service/API boundary — read via `listBindings` (not
`getBinding`) wherever a logical session is being assembled, group rows by
`(provider, providerSessionId)`, and expose the canonical `taskIds[]` the frontend type
already declares (`types.ts:408`). **Option B** (migrate the binding record itself to
a genuine `taskIds[]`, with the redefinitions and migration that implies) is the
alternative — see D5 for the full trade-off analysis. Do not start implementation
until D5 records an explicit choice.

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
  association display stays derived from the (once D5 is resolved and implemented)
  correctly-aggregated `taskIds` data, not a new editable UI.
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
- Whichever D5 option is chosen must not change `tools/specs.mjs start` →
  `autoBindAgentSession`'s existing behavior/semantics (`tools/specs.mjs:52-73,104`) —
  that call path binds one task at a time and stays out of scope; if Option A is
  chosen, `getBinding`'s single-record contract may stay unchanged for callers like
  `autoBindAgentSession` that genuinely want one row — only the session-assembly path
  (`AiSessionService`/`ai-routes.mjs`) needs to switch to the aggregating read.

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
6. **(Depends on D5 being resolved and implemented.)** Associated NEvo tasks are
   displayed — including every task when a session has more than one associated task,
   not just the first.
   `automated: npm --prefix tools/dashboard test`
7. **(Depends on D5 being resolved and implemented.)** A session created with
   `taskIds.length > 1` persists and can be read back as all of them, verified at the
   `AgentSessionBindingService`/`AiSessionService` layer, not only in a UI mock.
   `automated: node --test tools/tests/agent-binding.test.mjs`
8. Whichever D5 option is chosen, `getBinding`'s existing single-record callers (e.g.
   `autoBindAgentSession`) are unaffected — verified by the existing binding test
   suite continuing to pass unmodified in its currently-covered scenarios.
   `automated: node --test tools/tests/agent-binding.test.mjs`
9. Provider and mode are displayed where available.
   `inspection: open Session details for a session with a known provider/mode`
10. Delete is available and visually separated as destructive.
    `inspection: confirm delete sits in a visually distinct Actions area`
11. No new endpoint or UI action to change a session's associated specification is
    introduced (D4 boundary).
    `inspection: confirm ai-routes.mjs gains no new specId-mutation route from this task`
12. Manual task attach/detach is not introduced as a routine workflow.
    `inspection: confirm the tasks list in Session details is read-only`
13. Focus/dismiss behavior is accessible (focus trap while open, Escape closes, focus
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
- Migrating the binding record's on-disk shape (Option B of D5) unless D5 is resolved
  in that direction.
