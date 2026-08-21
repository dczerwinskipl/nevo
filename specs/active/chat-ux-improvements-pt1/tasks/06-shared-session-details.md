---
id: chat-ux-improvements-pt1.shared-session-details
status: draft
change: chat-ux-improvements-pt1
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
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
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
---

# Task: Introduce shared Session details

## Goal

Move session context (specification, associated tasks, provider, mode) and secondary
actions (delete) out of persistent chrome into a Session details Sheet/Dialog, opened
from the header's `ⓘ` entry point (Task 05).

This task carries two backend fixes discovered during repository mapping that block
correct display of data this UI needs, both authorized by `owner-decisions.md`:

1. **D3 — new dependency.** Add `@radix-ui/react-dialog` and build a Nevo-owned
   `Sheet`/`Dialog` primitive on top of it (`tools/dashboard/src/components/ui/dialog.tsx`,
   `sheet.tsx`), per `areas/react-component-guidelines.md` §2.2/§2.3/§3/§14/§25 — feature
   code (`SessionDetails`) must consume the Nevo wrapper, never import
   `@radix-ui/react-dialog` directly.
2. **D5 — `taskIds` collapse bug.** `AiSessionService.createSession`
   (`tools/ai/service.mjs:22`) currently collapses a multi-element `options.taskIds`
   down to a single `taskId` (or none) before calling `bindSession`, and the server
   binding record itself (`AgentSessionBindingService`, `tools/ai/binding-service.mjs:
   317-326`) only has a `taskId` field, not a `taskIds` array — so a session created
   with more than one linked task loses all but one at persistence time. Fix this at
   the persistence layer (binding record gains a genuine multi-valued task
   association; `createSession` stops collapsing `taskIds`) so Session details can
   correctly list every associated task. This is scoped narrowly to fixing the
   creation-time data loss — it is not a general edit/reassign capability (see D4).

## Implementation constraints

- Per **D4**: display the *current* specification association; do not add an endpoint
  or UI action to change it. `PATCH /api/agent-sessions/:provider/:providerSessionId`
  stays scoped to `mode` unless this task's own scope requires otherwise for the
  `taskIds` fix — do not fold a reassignment capability in "while we're here."
- Mobile: near-full-height/full-height Sheet, independently scrollable if needed, easy
  to dismiss, safe-area aware. Desktop: same content is acceptable for now (FR-15,
  explicitly deferred simplification) — do not design a separate desktop information
  architecture in this task.
- Structure: a Context section (specification, tasks, provider, mode) and a visually
  separated Actions section (delete) — destructive action must not sit next to
  informational content without visual separation.
- Manual task attach/detach is not introduced as a routine workflow (FR-16) — task
  association display stays derived from the (now-fixed) `taskIds` data, not a new
  editable UI.
- Reuse the existing `window.confirm(...)` + `useDeleteAiSession()` delete flow
  (`ai-chat.tsx:207-215`) rather than inventing new cancellation/deletion backend
  behavior — only its presentation location moves.
- Accessible focus management, Escape-to-close, and keyboard navigation are owned by
  the Sheet/Dialog primitive itself (`react-component-guidelines.md` §11), not
  reimplemented per-feature.
- The binding-record fix must not change `tools/specs.mjs start` →
  `autoBindAgentSession`'s existing behavior/semantics (`tools/specs.mjs:52-73,104`) —
  that call path is out of scope; only the persisted shape of what it and
  `createSession` write needs to actually hold multiple task IDs when given them.

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
6. Associated NEvo tasks are displayed — **including every task when a session has
   more than one associated task**, not just the first (this is the D5 fix's
   observable effect).
   `automated: npm --prefix tools/dashboard test`
7. A session created with `taskIds.length > 1` persists all of them (verified at the
   `AgentSessionBindingService`/`AiSessionService` layer, not only in a UI mock).
   `automated: npm --prefix tools/dashboard test`
8. Provider and mode are displayed where available.
   `inspection: open Session details for a session with a known provider/mode`
9. Delete is available and visually separated as destructive.
   `inspection: confirm delete sits in a visually distinct Actions area`
10. No new endpoint or UI action to change a session's associated specification is
    introduced (D4 boundary).
    `inspection: confirm PATCH .../ai-routes.mjs gains no new specId-mutation route from this task`
11. Manual task attach/detach is not introduced as a routine workflow.
    `inspection: confirm the tasks list in Session details is read-only`
12. Focus/dismiss behavior is accessible (focus trap while open, Escape closes,
    focus restored to the trigger on close).
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Changing which specification a session is associated with (FR-17's reassignment
  action) — deferred to Chat Capabilities per D4.
- A separate, simplified desktop information architecture — deferred per FR-15.
- General task attach/detach UI.
