---
id: ux-improvements-version-1.mode-description-tooltip
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - .nevo-ai-local/ux-review/report/02-chat-and-sessions.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/components/ai-session-create-modal.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/04-new-session-mock-and-slug-hierarchy.png
    - .nevo-ai-local/ux-review/screenshots/11-desktop-session-full-page-takeover.png
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Add mode descriptions to the session-header pills (CHAT-5)

## Goal

The "New session" modal shows each mode with a description ("Ask (Plan)" — "Tylko analiza i
planowanie", etc., `ai-session-create-modal.tsx:165` array). The session-header pills
(`ai-chat.tsx`) show only "ASK"/"EDIT"/"AGENT" with no description. Add a tooltip/long-press
description on the header pills, reusing the same description strings.

## Implementation constraints

- Reuse the existing description text from `ai-session-create-modal.tsx`'s mode array
  (`desc:` field) — do not write new copy.
- Tooltip/long-press only; do not change the pills' click behavior (still an instant switch,
  per CHAT-3).

## Acceptance criteria

1. Hovering/long-pressing a session-header mode pill shows the same description text as the
   creation modal's corresponding mode. `inspection: compare rendered tooltip text against ai-session-create-modal.tsx's desc strings`
2. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Pill sizing — see `mode-switcher-touch-target` (task 03).
