---
id: chat-ux-improvements-pt1.session-states-integration
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
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

# Task: Integrate Session Activity and Turn/Work Outcome presentation

## Goal

Present two distinct, correctly-scoped concepts compactly inside the new
header/Work/composer hierarchy, without inventing new provider semantics (FR-26) and
without requiring this task to know anything its allowed frontend-only data can't
actually provide (`owner-decisions.md` D9).

## Corrected vocabulary (D9)

The original framing of this task listed `idle | running | waitingForUser | completed
| failed` as "existing session states." Verification showed that's two different
concepts conflated:

- **Session Activity** — what `AiSessionService.resolveSessionActivity()`
  (`tools/ai/service.mjs:83-112`) actually computes: `idle | running |
  waitingForUser`. This is the only vocabulary `AiSessionStatus`
  (`tools/dashboard/src/lib/types.ts:346`) carries.
- **Turn/Work Outcome** — a property of the most recently finished turn, not the
  session: `successful | failed | cancelled/interrupted`. A turn ending any way
  (success, failure, cancellation) always leaves the session back at `idle` — outcome
  and activity are not the same axis.

There is still no `stopped` session-activity value, and this task does not add one.

## Implementation constraints

- Session Activity display (`idle`/`running`/`waitingForUser`) is fully derivable
  from data already reaching this task's `allowed_paths` (the session snapshot) — no
  backend/projection dependency for this half.
- Turn/Work Outcome display (distinguishing "failed" from "cancelled/interrupted"
  after a turn ends) depends on Task 01 exposing the turn's terminal `error.code`
  through the projection (`owner-decisions.md` D6/D9) — this task **consumes** that
  exposed value, it does not derive it itself (this task's `forbidden_paths` excludes
  `tools/ai/**`, so it structurally cannot compute this from raw events). If Task 01
  has not yet exposed that metadata when this task starts, this task may only show
  Turn/Work Outcome at the coarsest level its available data supports (e.g.
  "succeeded" vs. "did not complete successfully") and must not fabricate a
  finer-grained distinction.
- Reuse `ux-improvements-version-1`'s `shared-status-label-component`
  (`status-label.tsx`, if implemented at the time this task starts) across header,
  Work, and composer status displays for both Session Activity and Turn/Work Outcome
  — do not build a chat-local status treatment. If that task has not yet landed when
  this task starts, flag it at task-start per
  `docs/ai/specification-workflow.md`'s cross-change dependency handling rather than
  silently duplicating the component.
- Running does not require oversized header chrome (coordinates with Task 05's
  compact status pill).
- Completed Session Activity (i.e. back to `idle`) leaves no unnecessary persistent
  UI once the turn finishes — the *outcome* of that turn (successful/failed/
  cancelled) is what Work/history displays, not a lingering "session is completed"
  chrome element (no such Session Activity value exists).
- Existing stop/cancel control continues to work exactly as today.

## Acceptance criteria

1. All three actual Session Activity values (`idle`, `running`, `waitingForUser`)
   remain visible/discoverable somewhere in the redesigned chat.
   `inspection: simulate each activity value, confirm a visible indicator exists`
2. No UI element claims a session-level "completed" or "failed" activity state — those
   are rendered as Turn/Work Outcome (in Work/history), not Session Activity (in the
   header/composer status indicator).
   `inspection: confirm the header/composer status indicator only ever shows idle/running/waitingForUser`
3. Shared status label/token component is reused for both axes, not duplicated
   locally (once available; see implementation constraints for the not-yet-landed
   case).
   `inspection: grep for a chat-local status-label reimplementation`
4. Running does not require oversized header chrome.
   `inspection: compare header height while running vs. idle`
5. Turn/Work Outcome is displayed using only data Task 01's projection actually
   exposes — if fine-grained failed-vs-cancelled distinction isn't available yet, the
   coarser fallback is used, not a fabricated distinction.
   `inspection: confirm no outcome value is displayed that doesn't trace back to a field this task actually receives`
6. Existing stop/cancel control works unchanged.
   `automated: npm --prefix tools/dashboard test`
7. No new Session Activity or Turn/Work Outcome value is invented (no `stopped` added
   to `AiSessionStatus`; no new `AgentToolCall.status` value added — see D6/D9).
   `inspection: diff tools/dashboard/src/lib/types.ts's AiSessionStatus/AgentToolCall unions`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Building `shared-status-label-component` itself — that is
  `ux-improvements-version-1`'s task; this task only consumes it.
- Computing/deriving Turn/Work Outcome from raw events — that is Task 01's
  responsibility; this task is forbidden from `tools/ai/**` by design.
