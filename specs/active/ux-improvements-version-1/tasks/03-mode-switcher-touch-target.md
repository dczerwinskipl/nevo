---
id: ux-improvements-version-1.mode-switcher-touch-target
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - .nevo-ai-local/ux-review/report/02-chat-and-sessions.md
    - .nevo-ai-local/ux-review/report/05-accessibility-and-touch-targets.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/10-mobile-session-mode-pills-tiny.png
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Increase mode-switcher touch target (CHAT-2 / A11Y-3)

## Goal

Increase the ask/edit/agent mode-switcher pills (session header, `ai-chat.tsx`) to a
measured height of 36–40px on every viewport — they currently measure 19px tall
(31–45px wide), identical on desktop and mobile, below the 24px WCAG 2.5.8 AA floor.

## Implementation constraints

- No confirmation dialog for mode switching — that was considered and explicitly rejected
  (CHAT-3: every comparable tool — Claude Code, Cursor, Windsurf, Cline, GitHub Copilot Chat —
  treats mode switching as an instant, unconfirmed toggle). This task is sizing only.
- Increase height to 36–40px minimum, or switch to a full-width segmented control on mobile.
- Do not change the creation modal's mode selector (`ai-session-create-modal.tsx`) — it is not
  reported as undersized; only the session-header pills are.

## Acceptance criteria

1. Each of the ask/edit/agent pills measures ≥36px tall on both desktop and mobile viewports.
   `inspection: measure via getBoundingClientRect(), compare against the report's 19px baseline`
2. No confirmation step is added to mode switching. `inspection: confirm mode switch remains a single click/tap`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Mode description/tooltip content — see `mode-description-tooltip` (task 04).
