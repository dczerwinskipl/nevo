---
id: ux-improvements-version-1.delete-session-touch-target
status: verified
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/components/ai-session-list.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Increase delete-session icon touch target (CHAT-11 / A11Y-2)

## Goal

Increase the effective hit area of the "Usuń sesję z dysku" trash-icon button (currently
24×24px, `ai-chat.tsx:313`, `ai-session-list.tsx:157`) to ≥44px via padding, without changing
its visual size. A confirmation dialog already exists
(`window.confirm('Czy na pewno chcesz usunąć tę sesję z dysku?')` at `ai-chat.tsx:208` and
`ai-session-list.tsx:161`) — do not add a second one.

## Implementation constraints

- Increase the *clickable* padding around the 24px icon to reach a ≥44px effective target;
  the visible icon size does not need to change.
- Keep it far enough from the larger session-card click target that the two remain
  distinguishable — the two currently sit immediately adjacent.
- Do not touch the existing `window.confirm(...)` call — it already satisfies the "reversible
  vs. destructive" distinction the review draws relative to CHAT-3's mode-switch case.

## Acceptance criteria

1. The delete button's effective clickable area measures ≥44×44px on both files/locations
   (current baseline: 24×24px). `inspection: measure via getBoundingClientRect() including padding`
2. The `window.confirm` delete-confirmation flow still fires exactly as before (unchanged).
   `inspection: trigger delete, confirm the same confirm() dialog appears`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Replacing `window.confirm` with a styled dialog — not requested; the current native confirm
already distinguishes this destructive action from the intentionally unconfirmed mode-switch
interaction, and that distinction is sufficient as-is.
