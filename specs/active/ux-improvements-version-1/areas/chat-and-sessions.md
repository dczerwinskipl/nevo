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
- **Mode description parity (CHAT-5):** the creation modal shows each mode with a description
  (`ai-session-create-modal.tsx:164-168`'s inline array); the session-header pills already
  have their own `title` tooltip (`ai-chat.tsx:289-295`) but with independently-written,
  differently-worded text for the same modes — two diverging copies of the same metadata, not
  a missing tooltip.
- **Mock provider default (CHAT-6):** `ai-session-create-modal.tsx:22-26` hardcodes a
  mock-last sort, duplicating the order `tools/dashboard/server/ai-services.mjs:28` already
  provides. See owner decision D2 — fix is to delete the duplicate sort.
- **Task-checklist hierarchy (CHAT-7):** the task-context checklist in the creation modal
  renders the machine slug bold/monospace as primary text and the human title as smaller
  secondary text — inverted vs. every other task listing in the app.
- **Task↔session linking (CHAT-8):** `AiSession` already carries `taskId`/`taskIds`
  (`tools/dashboard/src/lib/types.ts:407-408`). Task → session already works: `TaskDialog`
  (`spec-detail.tsx`) renders a "Powiązane sesje" list of every session bound to the open
  task. Session → task does not reliably work: it is driven by ephemeral navigation-history
  state (`chatOriginTaskId` in `App.tsx`), not by the session's own `taskId` data — opening a
  task-bound session from any other entry point (e.g. the "Ostatnie rozmowy" list) loses the
  link even though the data relationship still exists.
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
- `mode-description-tooltip` introduces `tools/dashboard/src/lib/ai-mode-meta.ts`, a shared
  module for agent-mode id/label/description consumed by both the creation modal
  (`ai-session-create-modal.tsx`) and the session header (`ai-chat.tsx`) — one source of
  truth for mode metadata, not a copy in each component.

## Area-specific acceptance criteria

1. Composer `<textarea>` and `<button>` share the same bottom edge and the same
   `border-radius` (12px).
2. Mode-switcher pills measure ≥36px tall on every viewport.
3. Session-header mode pills and the creation modal render mode label/description text
   sourced from one shared module (`ai-mode-meta.ts`), not two independently-worded copies —
   no recall required, and no possibility of divergence.
4. `ai-session-create-modal.tsx` contains no `if (id === 'mock')`-style ordering logic; the
   rendered provider order matches `service.listProviders()`'s order exactly.
5. The task-context checklist renders task title as the primary (bold/larger) text and the
   slug as a small secondary caption, matching the pattern on the main task cards.
6. A task's detail continues to link to its related session(s) (already working); any session
   whose `taskIds`/`taskId` names one or more real tasks exposes a link back to **each** of
   them, regardless of how the session was opened, derived from that data — not from
   navigation-history state alone.
7. The delete-session trash icon's effective hit area is ≥44px (padding, not visual size
   change) on both mobile and desktop.

## Dependencies

None blocking — consumes the typography area's shared status-label component once it exists,
but has no separate status-label task of its own to sequence against it.

## Out of scope

- CHAT-9 (chat as a desktop side panel) — deferred, not tracked in this repository.
- CHAT-3 (mode-switch confirmation) — retracted, current behavior is correct.
- CHAT-10 — cross-reference only; its fix is `navigation-and-ia`'s `dedupe-recent-sessions`.
