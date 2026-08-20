---
id: ux-improvements-version-1.task-session-linking
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/ai-session-list.tsx
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/lib/types.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/App.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Make the task↔session link data-driven in both directions (CHAT-8)

## Goal

`AiSession` already carries `taskId`/`taskIds` (`tools/dashboard/src/lib/types.ts:407-408`).
The task → session direction already works: `TaskDialog` (`spec-detail.tsx:144-257`) renders a
"Powiązane sesje" section listing every session bound to the open task, each clickable via
`onOpenSession`. The session → task direction does not reliably work: it is driven entirely by
ephemeral navigation-history state (`chatOriginTaskId` in `App.tsx:54`, set inside
`openSession()` at `App.tsx:108-125`, surfaced as the "Wróć do taska" back-button label at
`App.tsx:160` / rendered in `ai-chat.tsx:244,264`), not by the session's own `taskId` data. A
session opened via any path other than clicking it from its task's "Powiązane sesje" list —
e.g. from the "Ostatnie rozmowy" list in `spec-detail.tsx:290-314` or the sidebar — always
resolves `originTaskId` to `null` (`App.tsx:117`, the `sessionRoute` guard is false on a fresh
open), even when that session's own `taskId` is set. Separately, `ai-session-list.tsx:91-96`
already resolves each session's linked task title as **text** (`Zadanie: <title>`) but does not
render it as a navigable link. Fix both: make the session → task link derive from
`session.taskId`/`taskIds` at every entry point, and make the existing text-only task
reference in `ai-session-list.tsx` clickable.

## Implementation constraints

- No new backend endpoint or data field — the relationship is already fully present in
  already-fetched data (`session.taskId`/`taskIds`, `change.tasks`).
- Do not remove or weaken the existing `chatOriginTaskId` "Wróć do taska"/"Wróć do
  specyfikacji" back-navigation behavior — it may continue to exist, but it must stop being
  the *only* signal that a related task exists. If a session's own `taskId`/`taskIds` names a
  real task, the "related task" link must be available regardless of `chatOriginTaskId`'s
  value.
- A task may have zero, one, or multiple related sessions; a session may have zero or one
  related task — every new UI element added here must handle the zero case (render nothing)
  without error.
- Do not change the "Kontekst całej specyfikacji" wording used for sessions that genuinely
  aren't bound to a specific task.

## Acceptance criteria

1. Opening a task's detail continues to show every session bound to it (via `taskId`/
   `taskIds`), each navigable to that session — regression check on the already-working
   direction. `inspection: open a task with at least one bound session, confirm the "Powiązane sesje" list and that clicking a session opens it`
2. Opening a session whose `taskId`/`taskIds` names a real task exposes a clickable link to
   that task, **regardless of how the session was opened** — verified specifically by opening
   a task-bound session from a task-agnostic entry point (e.g. the "Ostatnie rozmowy" list),
   not only via that task's own "Powiązane sesje" list. `inspection: open a task-bound session from the Ostatnie rozmowy list (not from its task), confirm the related-task link is present and correct`
3. In any session list that already renders a session's linked-task title as text
   (`ai-session-list.tsx:91-96`), that text becomes a clickable navigation to the task.
   `inspection: read the rendered session card, confirm the task reference is a link, click it`
4. A session with no bound task, or a task with no bound sessions, renders no related-item
   link (no broken/empty link). `inspection: verify the zero case in both directions`
5. After navigating from a session to its related task, that task is the one shown as
   selected/open — not whatever task `chatOriginTaskId` happened to hold from an unrelated
   prior navigation. `inspection: open task A, open a session bound to task B via a task-agnostic path, click that session's related-task link, confirm task B (not A) opens`
6. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

CHAT-9's two-pane desktop side-panel redesign — deferred; this task only makes the existing
full-page-takeover navigation model's task↔session relationship data-driven and consistently
navigable, it does not change the navigation model itself.
