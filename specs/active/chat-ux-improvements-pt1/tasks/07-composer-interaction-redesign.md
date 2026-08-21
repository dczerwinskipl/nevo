---
id: chat-ux-improvements-pt1.composer-interaction-redesign
status: draft
change: chat-ux-improvements-pt1
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional:
    - specs/active/ux-improvements-version-1/tasks/04-mode-description-tooltip.md
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/composer/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Redesign composer interaction

## Goal

Make long-form mobile prompting comfortable while keeping passive chat compact
(FR-18..FR-23). Today the composer is an inline `<form>` inside `AiChatPage`
(`ai-chat.tsx:436-491`) with a fixed `rows={1}`/`max-h-32` textarea, no auto-grow, no
compact/expanded state distinction, and `Enter` already submits
(`ai-chat.tsx:451-456`: `if (event.key === 'Enter' && !event.shiftKey) { ...
submitMessage(composer); }`) — this task inverts that.

## Implementation constraints

- Extract the composer into its own module-level component
  (`react-component-guidelines.md` §1.1, §20.1).
- **Enter inserts a newline; Enter must not send** (FR-21) — this reverses the current
  `ai-chat.tsx:451-456` behavior. Sending uses only the explicit send action.
- Compact/view state when not focused (preserve unsent draft, clearly tappable);
  expanded/edit state on focus, with a practical viewport-relative max height and
  internal scroll above it (FR-19).
- Blur-on-outside-tap (FR-20): tapping/clicking the chat content area outside the
  composer blurs it, closes the mobile keyboard, and returns to compact state without
  losing the draft. Implement as a scoped handler on the chat reading surface, **not**
  a global `document`-click hack — clicks on the header, Session details, Work
  expansion, buttons, and selectable/copyable content must keep working normally.
- Move the existing mode switcher into/near the composer (FR-23) — this is the
  relocation target Task 05 depends on. Reuse `ux-improvements-version-1`'s
  `ai-mode-meta.ts` (from its `mode-description-tooltip` task) for label/description
  if that task has landed; otherwise use the same label/description values currently
  inline in `ai-chat.tsx:278-299` without duplicating a second source of truth once
  that module exists.
- Do not add placeholder model/usage controls (FR-23) — no dead UI for capabilities
  that don't exist yet.
- Per `owner-decisions.md` D8: `ux-improvements-version-1`'s `composer-alignment` and
  `mode-switcher-touch-target` are "do not start independently" items — this task's
  redesign is what makes them moot, so do not implement or wait on those two tasks
  separately. `mode-description-tooltip` (`ai-mode-meta.ts`) is a dependency/reuse
  item — coordinate with it as described above, do not fork a second label source.
- Preserve existing send/stop/cancel semantics exactly (`ai-chat.tsx:474-488`'s toggle
  behavior) — do not invent new cancellation backend behavior (FR-22).
- State ownership: composer draft is local component state, not duplicated into a
  synced copy of query/session state (`react-component-guidelines.md` §24). If a
  composer draft must reset per-session, use `key={sessionId}` (§21.2) rather than a
  synchronization Effect.

## Acceptance criteria

1. `Enter` inserts a newline; it does not send.
   `automated: npm --prefix tools/dashboard test`
2. Sending uses only the explicit send action.
   `automated: npm --prefix tools/dashboard test`
3. Composer is compact when not focused; entering edit mode on focus.
   `inspection: focus/blur the composer, observe the state transition`
4. Long prompts (20+ lines) expand beyond one/two visible lines with internal scroll
   above a practical max height.
   `inspection: type a 20-line prompt, confirm expansion and internal scroll`
5. Tapping the chat content area outside the composer blurs it, closes the mobile
   keyboard (where applicable), returns to compact state, and preserves the draft.
   `automated: npm --prefix tools/dashboard test`
6. Other interactive controls (header, Session details, Work expansion, buttons,
   selectable content) are unaffected by the blur handler.
   `automated: npm --prefix tools/dashboard test`
7. The interaction scenario in the brief (§7, Task 07) passes end to end: tap composer
   → edit mode → type 20 lines → tap transcript → keyboard closes → composer compacts
   → draft preserved → tap composer → continue editing.
   `inspection: walk through the scenario manually or via a UI test`
8. Mode control is available in/near the composer, not the header (coordinates with
   Task 05's removal).
   `inspection: confirm mode control renders near the composer`
9. No dead/placeholder model or usage UI.
   `inspection: confirm no non-functional controls appear`
10. Existing send/stop/cancel behavior is unchanged in effect (only relocated/restyled
    if applicable).
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Header layout beyond removing the mode switcher (that removal is Task 05's own
  acceptance criterion, coordinated with this task's relocation).
- New keyboard shortcuts beyond Enter's redefinition (FR-21 explicitly defers desktop
  shortcuts to a later spec).
