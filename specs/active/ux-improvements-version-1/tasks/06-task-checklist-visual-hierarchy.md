---
id: ux-improvements-version-1.task-checklist-visual-hierarchy
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/ai-session-create-modal.tsx
    - tools/dashboard/src/components/status-board.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-session-create-modal.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix task-checklist visual hierarchy in the session-creation modal (CHAT-7)

## Goal

In the "New session" modal's task checklist (`ai-session-create-modal.tsx:203-224`, "Kontekst
zadań"), swap the visual weights: task title becomes the primary (bold/larger) text, the slug
becomes a small secondary caption — matching the pattern already used correctly on the main
task board's cards (`status-board.tsx:60,70`: the order number renders as a small `#01`-style
prefix, `task.title` renders as the primary `<h3 className="... font-semibold ...">`).

## Implementation constraints

- Currently: `<span className="font-mono text-[11px] text-[var(--muted-strong)]">{task.id}</span>`
  renders bold/monospace as effectively primary, `<span className="truncate text-[var(--foreground)]">{task.title}</span>`
  as secondary (line 220-221). Swap which one carries primary styling — do not remove either
  piece of information, just its visual weight.

## Acceptance criteria

1. In the task checklist, the task title renders with greater visual weight (size/boldness)
   than the slug. `inspection: compare rendered styles against the main task cards' id/title pattern`
2. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Checklist selection behavior — styling only.
