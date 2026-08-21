---
id: chat-ux-improvements-pt1.mobile-header-simplification
status: draft
change: chat-ux-improvements-pt1
depends_on: [shared-session-details, composer-interaction-redesign]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/chat-header/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Simplify mobile chat header

## Goal

Recover vertical space. Today's header (`ai-chat.tsx:260-322`) carries: back button,
title with a multi-level fallback chain, a status pill, an inline three-button mode
switcher (`ai-chat.tsx:277-300`), a cancel button, a delete button
(`ai-chat.tsx:307-316`), and a metadata line (spec/tasks/provider). This task strips it
to essentials once Task 06 (Session details) and Task 07 (composer, mode relocation)
have somewhere else for the removed controls to live — hence this task's dependency on
both.

## Implementation constraints

- Extract the header into its own module-level component (`react-component-guidelines.md`
  §1.1, §20.1) rather than leaving it as an inline JSX block inside `AiChatPage`.
- Remove the mode switcher from the header (moved into/near the composer by Task 07)
  and the delete button (moved into Session details by Task 06).
- Keep: back/navigation, session title, a compact status indicator, and the one
  Session details entry point (`ⓘ` icon opening Task 06's Sheet).
- Do not remove or weaken the existing cancel/stop control's reachability — it may
  remain in the header or move near the composer (Task 07's call), but it must not
  become unreachable.
- No dead model/usage UI — do not add placeholder controls for capabilities that don't
  exist yet (NFR mirrors FR-23).
- Reuse `ux-improvements-version-1`'s shared status primitives/tokens once available
  (see Task 09 and Task 11's overlap notes) rather than a chat-local status treatment.
- Per `owner-decisions.md` D8: `ux-improvements-version-1`'s `mode-switcher-touch-
  target` and the header instance of `delete-session-touch-target` target exactly the
  header controls this task removes — do not implement or wait on those tasks
  independently; this task's removal is what makes them moot, not a touch-target fix
  applied to code about to be deleted.

## Acceptance criteria

1. Header contains only: back/navigation, title, compact status, one Session details
   entry point (plus cancel/stop while running, wherever Task 07 places it).
   `inspection: render the header, enumerate visible controls`
2. Mode switcher is not present in the header.
   `inspection: confirm no mode pills render in the header`
3. Delete is not present in the header.
   `inspection: confirm no delete/trash icon renders in the header`
4. The Session details entry point opens Task 06's Session details Sheet/Dialog.
   `automated: npm --prefix tools/dashboard test`
5. Narrow mobile widths do not clip or wrap the header controls unusably.
   `inspection: render at 320px/375px viewport widths`
6. Navigation (back button) remains functionally unchanged.
   `inspection: click back, confirm existing navigation behavior`
7. No dead/placeholder model or usage UI is introduced.
   `inspection: confirm no non-functional controls appear in the header`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Session details content — Task 06.
- Composer/mode relocation target — Task 07.
- Status token/label unification across the whole app — Task 09 and
  `ux-improvements-version-1`'s `shared-status-label-component` (dependency, not
  duplicated here).
