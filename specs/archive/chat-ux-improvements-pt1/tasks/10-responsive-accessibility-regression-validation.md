---
id: chat-ux-improvements-pt1.responsive-accessibility-regression-validation
status: draft
change: chat-ux-improvements-pt1
depends_on:
  - conversation-message-presentation
  - per-turn-work-presentation
  - tool-activity-normalization-and-details
  - mobile-header-simplification
  - shared-session-details
  - composer-interaction-redesign
  - streaming-and-scroll-behavior
  - session-states-integration
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/**
  - tools/dashboard/src/lib/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Responsive, accessibility, and regression validation

## Goal

Validate the redesigned chat as one coherent experience once Tasks 02-09 have all
landed — narrow widths, keyboard-open states, accessibility baseline, and regression
safety for everything the redesign could have silently broken (NFR-1, NFR-2, NFR-7,
NFR-8).

## Implementation constraints

- This task may make small cross-cutting fixes surfaced by validation (e.g. a missed
  `aria-label`, a narrow-width clip found only once every prior task's changes compose
  together) — it does not re-open any prior task's design decisions; if a fix would
  require one, stop and report it rather than reworking scope here.
- Cover every regression area listed in the brief's NFR-7: sending, stopping/
  cancelling, session navigation, mode behavior, delete, raw tool inspection, session/
  task/spec display, markdown/code rendering.

## Acceptance criteria

1. No horizontal overflow on supported mobile widths across the whole redesigned
   surface (header, conversation, Work, composer, Session details).
   `inspection: render at 320px/375px/414px viewport widths`
2. Header remains usable at all supported widths.
   `inspection: manual check`
3. Composer works with the mobile keyboard open (viewport adjustment, no clipped
   input).
   `inspection: simulate keyboard-open viewport height`
4. Long prompts remain usable (composer expansion + internal scroll from Task 07).
   `inspection: manual check`
5. Assistant markdown/code remains readable.
   `automated: npm --prefix tools/dashboard test`
6. Work details remain usable with large payloads.
   `inspection: manual check with a large tool output`
7. Session details works on both mobile and desktop.
   `inspection: manual check at both breakpoints`
8. Controls have accessible names.
   `automated: npm --prefix tools/dashboard test`
9. Expanded/collapsed state (messages, Work, tool details) is exposed via appropriate
   ARIA/state, not only visually.
   `inspection: inspect ARIA attributes on expand/collapse controls`
10. Role/status distinction is not color-only anywhere in the redesigned surface.
    `inspection: grayscale/contrast check`
11. Desktop keyboard navigation works for core controls (composer, send, Session
    details open/close, Work expand/collapse).
    `inspection: manual keyboard-only walkthrough`
12. Desktop remains usable without the final desktop workspace redesign (FR-15's
    accepted temporary duplication is documented, not silently left unexplained).
    `inspection: confirm overview.md/FR-15 note is accurate to what shipped`
13. All NFR-7 regression areas (send, stop/cancel, navigation, mode, delete, raw tool
    inspection, session/task/spec display, markdown/code) are verified against the
    pre-change baseline behavior.
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- New features beyond validation and the small fixes described above.
- Final desktop workspace redesign (explicitly deferred, brief §3.3).
