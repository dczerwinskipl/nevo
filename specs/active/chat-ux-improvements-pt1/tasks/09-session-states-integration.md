---
id: chat-ux-improvements-pt1.session-states-integration
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/ux-improvements-version-1/tasks/18-shared-status-label-component.md
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/work/**
  - tools/dashboard/src/components/composer/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Integrate existing session states

## Goal

Present the existing session states (`idle | running | waitingForUser | completed |
failed` — `tools/dashboard/src/lib/types.ts:346`; there is no `stopped` value,
cancellation resolves to `idle` via `turn.failed`/`AI_TURN_CANCELLED`,
`tools/ai/turn-runtime.mjs:565,568`) compactly inside the new header/Work/composer
hierarchy, without inventing new provider semantics (FR-26).

## Implementation constraints

- Reuse `ux-improvements-version-1`'s `shared-status-label-component`
  (`status-label.tsx`, if implemented at the time this task starts) across header,
  Work, and composer status displays — do not build a chat-local status treatment. If
  that task has not yet landed when this task starts, flag it at task-start per
  `docs/ai/specification-workflow.md`'s cross-change dependency handling rather than
  silently duplicating the component.
- Running does not require oversized header chrome (coordinates with Task 05's
  compact status pill).
- Completed state leaves no unnecessary persistent UI once the turn finishes.
- Failed/stopped(cancelled-back-to-idle) remain visually distinguishable from each
  other and from running/completed.
- Do not invent a `stopped` status value — cancellation is represented using the
  existing `idle`/`failed` vocabulary already in the codebase.
- Existing stop/cancel control continues to work exactly as today.

## Acceptance criteria

1. All currently-supported states (`idle`, `running`, `waitingForUser`, `completed`,
   `failed`) remain visible/discoverable somewhere in the redesigned chat.
   `inspection: simulate each state, confirm a visible indicator exists`
2. Shared status label/token component is reused, not duplicated locally (once
   available; see implementation constraints for the not-yet-landed case).
   `inspection: grep for a chat-local status-label reimplementation`
3. Running does not require oversized header chrome.
   `inspection: compare header height while running vs. idle`
4. Completed state does not leave unnecessary persistent UI.
   `inspection: confirm no lingering "in progress" affordance after completion`
5. Failed and cancelled-to-idle remain distinguishable from each other.
   `inspection: simulate a failure and a cancellation, compare their indicators`
6. Existing stop/cancel control works unchanged.
   `automated: npm --prefix tools/dashboard test`
7. No new provider/session state is invented (no `stopped` value added to the type).
   `inspection: diff tools/dashboard/src/lib/types.ts's AiSessionStatus union`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Building `shared-status-label-component` itself — that is
  `ux-improvements-version-1`'s task; this task only consumes it.
