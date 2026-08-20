---
id: ux-improvements-version-1.escape-key-closes-all-modals
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/typography-and-consistency.md
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/ai-session-create-modal.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-session-create-modal.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Wire Escape to close the "New session AI" modal (TYPO-3)

## Goal

The task-detail modal already closes on `Escape` via a `keydown` listener
(`spec-detail.tsx:188-211`). The "New session AI" modal
(`ai-session-create-modal.tsx`) has no such listener — `Escape` does nothing, and its
backdrop keeps blocking clicks until the "Zamknij tworzenie sesji" button is used instead.
Add the same `Escape`-closes behavior to this modal.

## Implementation constraints

- Mirror `spec-detail.tsx`'s existing `keydown`/`Escape` listener pattern (add/remove on
  mount/unmount) rather than inventing a different mechanism.
- Do not close the modal on `Escape` while a session is being created
  (`createSession.creating`) — mirror the same guard already used for the backdrop-click
  close (`onMouseDown` handler checks `!createSession.creating`).

## Acceptance criteria

1. Pressing `Escape` while the "New session AI" modal is open closes it, the same way it
   already closes the task-detail modal. `inspection: open the modal, press Escape, confirm it closes`
2. `Escape` does not close the modal while `createSession.creating` is true.
   `inspection: trigger session creation, press Escape mid-request, confirm the modal stays open`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Migrating both modals onto one shared `Dialog` component — the report suggests this as an
"ideally," but it's a larger refactor than this specific defect requires; each modal keeps its
own implementation, just with matching `Escape` behavior.
