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
    - tools/dashboard/src/components/session-details/session-details.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/lib/types.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/session-details/session-details.tsx
  - tools/dashboard/src/components/app-sidebar.tsx
  - tools/dashboard/src/App.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Make the task↔session link data-driven and many-to-many in both directions (CHAT-8)

## Goal

`AiSession` carries both `taskIds: string[]` (the canonical collection — zero, one, or many
task IDs) and a legacy optional `taskId?: string` (`tools/dashboard/src/lib/types.ts:407-408`).
The "New session" creation flow already reflects this: its task checklist lets the user pick
"zero lub wiele" tasks and submits `taskIds: string[]` (`ai-session-create-modal.tsx`). A task,
symmetrically, can have any number of sessions bound to it.

The task → session direction already works: `TaskDialog` (`spec-detail.tsx:144-257`) renders a
"Powiązane sesje" section listing every session bound to the open task, each clickable via
`onOpenSession`. The session → task direction does not reliably work, for two separate reasons:

1. It is driven by ephemeral navigation-history state (`chatOriginTaskId` in `App.tsx:54`, set
   inside `openSession()` at `App.tsx:108-125`, surfaced as the single "Wróć do taska"
   back-button label at `App.tsx:160` / rendered in `ai-chat.tsx:244,264`) — a single value,
   not `session.taskId`/`taskIds` data. A session opened via any path other than clicking it
   from one specific task's "Powiązane sesje" list — e.g. from the "Ostatnie rozmowy" list in
   `spec-detail.tsx:290-314` or the sidebar — always resolves `originTaskId` to `null`
   (`App.tsx:117`), even when the session's own `taskIds` names one or more real tasks.
2. Even where the data *is* already read, it's collapsed to a single value: `ai-session-list.tsx:91-96`
   already computes `taskList` (the full array — `session.taskIds` if present, else
   `[session.taskId]`, else `[]`) and resolves each entry's title, but renders the result as
   **joined display text** (`linked.join(' · ')`, line 151) — not as individually clickable
   links. Both a single `chatOriginTaskId`-based back-button and a joined text string are
   incompatible with a session that names more than one task.

`AiSessionRow` (`ai-session-list.tsx:73-96`) is the one shared component both entry points
render through: `SpecDetail` via `AiSessionList` (`spec-detail.tsx`'s "Ostatnie rozmowy" panel
and `TaskDialog`'s "Powiązane sesje" list), and `AppSidebar`, which imports and calls
`AiSessionRow` directly (`app-sidebar.tsx:16,241`). `AppSidebar` today has no way to navigate
to a task at all — it only wires `onOpen` (open the session) and `onDelete`. For the sidebar's
sessions to expose working related-task links too (required by AC 2 below — "regardless of how
the session was opened" includes sessions opened from the sidebar), `AppSidebar` needs to gain
and forward a task-navigation callback, sourced from `App.tsx`.

Fix both: derive the session → task relationship from `session.taskId`/`taskIds` at every
entry point (not from navigation history), and make each task in that collection its own
clickable link — not one link, not joined text — in every place `AiSessionRow` renders,
including `AppSidebar`.

## Implementation constraints

- No new backend endpoint or data field — the relationship is already fully present in
  already-fetched data (`session.taskId`/`taskIds`, `change.tasks`).
- Treat `taskIds` as the canonical collection (already used this way in
  `ai-session-list.tsx:91-95`'s `taskList` computation); do not reduce it to "the first task"
  or otherwise pick one arbitrarily. If a session names multiple tasks, all of them must be
  individually reachable from the UI (e.g. one link per task, not a single link to an
  arbitrary member of the set).
- Do not remove or weaken the existing `chatOriginTaskId` "Wróć do taska"/"Wróć do
  specyfikacji" back-navigation behavior — it may continue to exist for history/back
  navigation, but it is not, and must not become, the source of truth for the session↔task
  *relationship*. That relationship is `session.taskId`/`taskIds` only.
- A `taskId`/entry in `taskIds` that no longer matches any task in `change.tasks` (stale/
  deleted task) must not produce a broken link or a thrown error — `ai-session-list.tsx:96`
  already falls back to displaying the raw ID string when no matching task title is found;
  preserve at least that safety (render the stale reference as inert text, or omit it, but
  never navigate to a nonexistent task or crash).
- Do not change the "Kontekst całej specyfikacji" wording used for sessions with an empty
  `taskIds`/no `taskId`.
- Task navigation from a related-task link must be an explicit callback/presentation contract
  on the shared `AiSessionRow` (e.g. an `onOpenTask(taskId)`-shaped prop — the exact name is
  an implementation detail) — not routing/navigation logic embedded inside `AiSessionRow`
  itself. `AiSessionRow` renders the links; it does not decide how navigating to a task works.
- `App.tsx` remains the owner of navigation between main views. The actual behavior behind the
  callback (selecting the right spec if it isn't already the open one, then opening that
  task's detail) is implemented in `App.tsx` (or delegated by it to `SpecDetail`'s existing
  `selectedTaskId` mechanism) — not duplicated ad hoc in `AppSidebar` or `AiSessionRow`.
- Do not introduce a global event bus, a shared mutable navigation singleton, or any direct
  dependency from `AiSessionRow`/`ai-session-list.tsx` on the router/history API — navigation
  stays a prop passed down from whichever ancestor owns it.
- Do not duplicate `AiSessionRow`'s row implementation to give `AppSidebar` its own
  navigation-capable variant — `AppSidebar` continues to use the one shared component, now
  also passing it the navigation callback.
- The task-navigation callback prop must be optional on `AiSessionRow`. Every current call
  site either passes a working callback (and gets working related-task links), or — if a
  caller genuinely has no sensible way to navigate to a task — knowingly omits the callback,
  in which case `AiSessionRow` must not render related-task links for that caller (no broken
  links, no dead click targets). Concretely: `SpecDetail`'s own usages and `AppSidebar` must
  both pass a working callback, since both have a task to navigate to within this task's
  scope.

## Acceptance criteria

1. Opening a task's detail continues to show every session bound to it (via `taskId`/
   `taskIds`), each navigable to that session — regression check on the already-working
   direction. `inspection: open a task with at least one bound session, confirm the "Powiązane sesje" list and that clicking a session opens it`
2. Opening a session whose `taskId`/`taskIds` names one or more real tasks exposes a clickable
   link for **each** named task, **regardless of how the session was opened** — verified
   specifically by opening a task-bound session from a task-agnostic entry point (e.g. the
   "Ostatnie rozmowy" list), not only via one of its tasks' "Powiązane sesje" list.
   `inspection: open a task-bound session from the Ostatnie rozmowy list (not from one of its tasks), confirm every related-task link is present and correct`
3. A task-bound session rendered via `AppSidebar`'s `AiSessionRow` usage
   (`app-sidebar.tsx:241`) also exposes working related-task link(s), using the navigation
   callback `AppSidebar` now receives from `App.tsx` — the sidebar is one of the entry points
   AC 2 requires, not an exception to it.
   `inspection: with the sidebar open, find a task-bound session, confirm its related-task link(s) work and navigate correctly`
4. A session bound to **multiple** tasks (`taskIds.length > 1`) exposes a working link to each
   one — not just the first, not a single ambiguous link.
   `inspection: create or find a session with 2+ taskIds, confirm each resolves to its own working link`
5. Wherever `ai-session-list.tsx` already resolves linked-task titles (`taskList`/`linked` at
   lines 91-96), each resolved task becomes its own clickable navigation target instead of
   plain joined text — in every caller that supplies the navigation callback.
   `inspection: read the rendered session row in each caller, confirm each task reference is individually clickable, click each`
6. A session with an empty `taskIds` and no `taskId` renders no related-task link; a task with
   no bound sessions renders no related-session link (no broken/empty link either direction).
   `inspection: verify the zero case in both directions`
7. A stale/nonexistent task ID in a session's `taskIds` does not crash the UI or navigate to a
   broken destination. `inspection: construct a session referencing a taskId absent from change.tasks, confirm no crash and no dead link`
8. After navigating from a session to one of its related tasks, that specific task is the one
   shown as selected/open — not whatever task `chatOriginTaskId` happened to hold from an
   unrelated prior navigation. `inspection: open task A, open a (task-agnostic) session bound to task B, click the link to task B, confirm task B (not A) opens`
9. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- CHAT-9's two-pane desktop side-panel redesign — deferred; this task only makes the existing
  full-page-takeover navigation model's task↔session relationship data-driven, many-to-many
  where the data is, and consistently navigable — it does not change the navigation model
  itself.
- `dedupe-recent-sessions` (task 09) later simplifies `AppSidebar`'s compact row further,
  including removing its linked-task subtitle. This task does not depend on that one and must
  be independently correct within its own `allowed_paths` — it delivers working related-task
  links in the sidebar's current row shape; task 09 is free to reshape that row afterward
  without this task needing to anticipate it.
