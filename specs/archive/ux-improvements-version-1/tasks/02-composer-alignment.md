---
id: ux-improvements-version-1.composer-alignment
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix composer input/send-button misalignment (CHAT-1)

## Goal

Fix the measured 6–8px vertical misalignment between the composer `<textarea>` and its send
button, and unify their `border-radius`, in `tools/dashboard/src/components/ai-chat.tsx`.

## Implementation constraints

- Measured (identical in idle and running state, so it's a static layout bug):
  `<textarea>` `top:1161 bottom:1207 height:46px border-radius:12px`;
  `<button>` `top:1169 bottom:1213 height:44px border-radius:8px`. Parent form
  (`<form class="flex items-end gap-2">`) already sets `align-items: flex-end`; root cause is
  a `<label>` wrapping the textarea that doesn't pass the flex row's height through.
- Suggested fix: remove the `<label>` from the flex flow (`display: contents` on it, or move
  `align-items` to an inner wrapper around just the textarea).
- Unify `border-radius` on both elements to 12px (matches other form fields in the app, e.g.
  the "New session" modal fields).

## Acceptance criteria

1. `<textarea>` and `<button>` share the same `bottom` edge (±1px), in both idle and
   generating states. `inspection: measure via getBoundingClientRect() in both states, compare against the baseline in "Implementation constraints" above`
2. Both elements use `border-radius: 12px`. `inspection: read computed style`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Composer content/behavior (message sending, mode switching) — layout only.
