---
id: ux-improvements-version-1.task-session-linking
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - .nevo-ai-local/ux-review/report/02-chat-and-sessions.md
    - tools/dashboard/src/components/status-board.tsx
    - tools/dashboard/src/components/ai-session-list.tsx
    - tools/dashboard/src/lib/types.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/status-board.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Bidirectional task↔session link (CHAT-8)

## Goal

Surface the task↔session relationship that already exists as data
(`AiSession.taskId`/`taskIds`, `tools/dashboard/src/lib/types.ts:407-408`) as a clickable,
bidirectional link: a "related session(s)" chip on the task card (`TaskCard` in
`status-board.tsx:24`), and a "related task" chip on the session card/header
(`ai-session-list.tsx`), both navigable.

## Implementation constraints

- No new backend endpoint or data field — join the already-fetched task list and session list
  client-side by `taskId`/`taskIds`.
- A task may have zero, one, or multiple related sessions; a session may have zero or one
  related task — the chip must handle the zero case (render nothing) without error.
- Do not change the "Kontekst całej specyfikacji" (whole-spec context) wording for sessions
  that aren't bound to a specific task — only add the chip where a real `taskId` exists.

## Acceptance criteria

1. A task card with at least one session referencing its ID renders a clickable "related
   session" chip that navigates to that session. `inspection: create/inspect a task with a bound session, click the chip`
2. A session bound to a task renders a clickable "related task" chip that navigates to that
   task. `inspection: open a session with taskId set, click the chip`
3. A task with no related sessions, or a session with no bound task, renders no chip (no
   broken/empty link). `inspection: verify the zero case`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

CHAT-9's two-pane desktop side-panel redesign — deferred; this task only adds a navigable
chip within the existing full-page-takeover navigation model.
