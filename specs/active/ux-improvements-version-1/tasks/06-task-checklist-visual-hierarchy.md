---
id: ux-improvements-version-1.task-checklist-visual-hierarchy
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - .nevo-ai-local/ux-review/report/02-chat-and-sessions.md
    - tools/dashboard/src/components/ai-session-create-modal.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/04-new-session-mock-and-slug-hierarchy.png
    - .nevo-ai-local/ux-review/screenshots/01-desktop-home.png
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
task cards (`01-desktop-home.png`, where `#01` is a small prefix and the title is primary).

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
