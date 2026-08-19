---
id: ux-improvements-version-1.move-connectivity-indicator
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - .nevo-ai-local/ux-review/report/03-navigation-and-ia.md
    - tools/dashboard/src/App.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/App.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Move the connectivity indicator out of primary header chrome (NAV-6)

## Goal

`{live ? 'Pliki połączone' : 'Ponowne łączenie'}` (`App.tsx:183`) currently sits permanently
top-right with the same visual weight as the app logo/name on every screen. Move it to a
footer/status-bar element, or collapse it to an icon-only state that expands on hover/click.

## Implementation constraints

- Keep the same underlying `live` state and both message strings — presentation/placement
  only, not the connectivity logic itself.
- Whichever placement is chosen, the indicator must still be visible/discoverable when
  disconnected (`'Ponowne łączenie'`) — don't hide a real reconnection-in-progress state
  entirely.

## Acceptance criteria

1. The connectivity indicator no longer renders with primary-header visual weight next to the
   logo/app name. `inspection: compare header layout before/after`
2. Both connected and reconnecting states remain visible/discoverable in the new placement.
   `inspection: simulate both states, confirm each is still legible`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Any change to the underlying SSE/connectivity detection logic.
