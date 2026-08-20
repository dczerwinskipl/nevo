---
id: ux-improvements-version-1.mode-description-tooltip
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/components/ai-session-create-modal.tsx
    - tools/dashboard/src/lib/types.ts
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-session-create-modal.tsx
  - tools/dashboard/src/lib/ai-mode-meta.ts
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: One shared source for agent-mode label/description text (CHAT-5)

## Goal

Mode metadata (id, label, description) for `ask`/`edit`/`agent` currently exists as two
independent, divergently-worded copies: the "New session" modal's inline array
(`ai-session-create-modal.tsx:164-168`, e.g. `{ id: 'ask', label: 'Ask (Plan)', desc: 'Tylko
analiza i planowanie' }`), and the session-header pills' own `title` tooltip
(`ai-chat.tsx:289-295`, e.g. `'Tryb Ask (Plan) - tylko odczyt i analiza bez modyfikacji
plików'` for the same mode) — a tooltip already exists on the header pills, it just says
something different from the creation modal for the same mode. Extract one shared module,
`tools/dashboard/src/lib/ai-mode-meta.ts`, exporting the canonical per-mode id/label/
description, and have both components import from it instead of each maintaining its own copy.

## Implementation constraints

- `ai-mode-meta.ts` is the single source of truth for mode id, display label, and description
  text for `ask`/`edit`/`agent`. Consolidate the two existing, differently-worded description
  texts into one canonical description per mode (an implementation detail — pick or combine
  whichever existing wording is clearer; no new copy needs owner sign-off, this is
  deduplication of text that already exists in two variants).
- `ai-session-create-modal.tsx` and `ai-chat.tsx` must both import mode metadata from
  `ai-mode-meta.ts` — neither file may contain its own inline copy of the label/description
  strings after this task.
- Keep each component's own presentation (the creation modal shows label + description
  inline; the session header shows a short label with the description as a tooltip) — this
  task consolidates the *data*, not the two components' different layouts.

## Acceptance criteria

1. `tools/dashboard/src/lib/ai-mode-meta.ts` exports one canonical id/label/description entry
   per mode (`ask`, `edit`, `agent`). `inspection: read the new module`
2. Neither `ai-session-create-modal.tsx` nor `ai-chat.tsx` contains an inline literal array/
   object duplicating mode label or description text — both import from `ai-mode-meta.ts`.
   `inspection: grep both files for the mode description strings, confirm they only appear in ai-mode-meta.ts`
3. For the same mode, the creation modal's description and the session-header tooltip's
   description render identical text (same source, so no divergence is possible).
   `inspection: open the creation modal and a session header side by side, compare text for each mode`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Pill sizing — see `mode-switcher-touch-target` (task 03).
- Any change to which modes exist or what they do — copy/data consolidation only.
