# Area: Chat & AI Sessions

## Responsibility

Fix the chat/session surface's measured layout, sizing, wording, and linkage defects: the
composer, the mode switcher, session-header mode descriptions, the mock-provider default, the
task-checklist hierarchy, task↔session linking, and the delete-session touch target. Does
**not** cover the CHAT-9 side-panel redesign — that's deferred (opportunity, not a defect).

## Current state

- **Composer alignment (CHAT-1):** `<textarea>` at `top:1161 bottom:1207 height:46px
  border-radius:12px`, `<button>` at `top:1169 bottom:1213 height:44px border-radius:8px` —
  measured identically in idle and running state, so this is a static layout bug, not
  state-dependent. Parent form sets `align-items: flex-end` but a `<label>` wrapping the
  textarea breaks the flex row's height pass-through.
- **Mode switcher size (CHAT-2 / A11Y-3):** ask/edit/agent pills measured at 19px tall
  (31–45px wide), identical on desktop and mobile — no responsive adjustment. Below the 24px
  WCAG 2.5.8 AA floor.
- **Mode description parity (CHAT-5):** creation modal shows "Ask (Plan)" / "Edit (Domyślnie)"
  / "Agent (Auto)" with a description line each; the session-header pills show only "ASK" /
  "EDIT" / "AGENT", no description.
- **Mock provider default (CHAT-6):** `ai-session-create-modal.tsx:22-26` hardcodes a
  mock-last sort, duplicating the order `tools/dashboard/server/ai-services.mjs:28` already
  provides. See owner decision D2 — fix is to delete the duplicate sort.
- **Task-checklist hierarchy (CHAT-7):** the task-context checklist in the creation modal
  renders the machine slug bold/monospace as primary text and the human title as smaller
  secondary text — inverted vs. every other task listing in the app.
- **Task↔session linking (CHAT-8):** `AiSession` already carries `taskId`/`taskIds`
  (`tools/dashboard/src/lib/types.ts:407-408`); no UI surfaces it as a clickable link in
  either direction today.
- **Delete touch target (CHAT-11 / A11Y-2):** delete already prompts via
  `window.confirm('Czy na pewno chcesz usunąć tę sesję z dysku?')`
  (`ai-chat.tsx:208`, `ai-session-list.tsx:157`) — confirmed present, contrary to the review's
  "unverified" note. Remaining problem: the trash icon button is exactly 24×24px, directly
  adjacent to the much larger session-card click target.

## Requirements

Seven tasks: `composer-alignment`, `mode-switcher-touch-target`, `mode-description-tooltip`,
`mock-provider-config-order`, `task-checklist-visual-hierarchy`, `task-session-linking`,
`delete-session-touch-target`.

## Constraints

- `mock-provider-config-order` must not introduce a new frontend ordering rule of any kind —
  it renders whatever order the API returns (owner decision D2).
- `delete-session-touch-target` does not add a confirmation dialog — one already exists; only
  the hit-target size changes.

## Interfaces and boundaries

- `mock-provider-config-order`'s badge styling for the (now-last) mock tile uses the existing
  `--muted-strong` neutral token — no new token needed from `areas/colors.md`.
- Session-status wording shown on session cards/headers is rendered by the shared
  `<StatusLabel>` component built in `areas/typography-and-consistency.md`'s
  `shared-status-label-component` task (covers CHAT-4) — this area does not build that
  component itself, only consumes it at its two session-status render sites.

## Area-specific acceptance criteria

1. Composer `<textarea>` and `<button>` share the same bottom edge and the same
   `border-radius` (12px).
2. Mode-switcher pills measure ≥36px tall on every viewport.
3. Session-header mode pills expose the same description text as the creation modal (tooltip
   or equivalent), without requiring recall.
4. `ai-session-create-modal.tsx` contains no `if (id === 'mock')`-style ordering logic; the
   rendered provider order matches `service.listProviders()`'s order exactly.
5. The task-context checklist renders task title as the primary (bold/larger) text and the
   slug as a small secondary caption, matching the pattern on the main task cards.
6. A task card links to its related session(s) and a session card/header links back to its
   bound task, both navigable, using only already-fetched `taskId`/`taskIds` data.
7. The delete-session trash icon's effective hit area is ≥44px (padding, not visual size
   change) on both mobile and desktop.

## Dependencies

None blocking — consumes the typography area's shared status-label component once it exists,
but has no separate status-label task of its own to sequence against it.

## Out of scope

- CHAT-9 (chat as a desktop side panel) — deferred, see `07-deferred-v2-proposals.md`.
- CHAT-3 (mode-switch confirmation) — retracted, current behavior is correct.
- CHAT-10 — cross-reference only; its fix is `navigation-and-ia`'s `dedupe-recent-sessions`.
