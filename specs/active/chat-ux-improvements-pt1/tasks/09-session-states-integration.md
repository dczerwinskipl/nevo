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
    - tools/dashboard/src/components/ai-session-list.tsx
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/ux-improvements-version-1/tasks/18-shared-status-label-component.md
    - specs/active/ux-improvements-version-1/tasks/09-dedupe-recent-sessions.md
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/work/**
  - tools/dashboard/src/components/composer/**
  - tools/dashboard/src/lib/types.ts
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
  (`tools/ai/service.mjs:83-112`) actually *computes* (the only values this task may
  treat as live/producible): `idle | running | waitingForUser`.
- **Turn/Work Outcome** — a property of the most recently finished turn, not the
  session: `successful | failed | cancelled/interrupted`. A turn ending any way
  (success, failure, cancellation) always leaves the session back at `idle` — outcome
  and activity are not the same axis.

**Second correction (`owner-decisions.md` D9, final): the dead members are removed,
not preserved.** An intermediate revision of this spec found `AiSessionStatus`
*declared* (`tools/dashboard/src/lib/types.ts:346`) 5 members —
`'idle' | 'running' | 'waitingForUser' | 'completed' | 'failed'` — with real (if dead)
consumers of `'completed'`/`'failed'` in `ai-chat.tsx:457,465,482` (composer-disable
checks) and `ai-session-list.tsx:116,128,234-235,46` (status icon, badge tone,
`statusLabel`, and a current/completed list split) and, on that basis, directed this
task to leave the type and both files alone. A follow-up review reversed that
conclusion: no evidence was found anywhere in the repository that `'completed'`/
`'failed'` are reserved for an imminent concrete contract (no `completedAt` producer,
no comment near the declaration indicating intent), and preserving harmless-looking
dead branches "because they already exist" is worse than removing them once their
falseness is understood. **This task now:**

- narrows `AiSessionStatus` to `'idle' | 'running' | 'waitingForUser'` (types.ts:346);
- removes the `session?.status === 'completed'` checks in `ai-chat.tsx:457,465,482`
  (the composer is no longer conditionally disabled/relabeled by a session status that
  can no longer exist — verify what condition should replace each check contextually,
  e.g. drop the clause rather than leaving a always-`false`/dead comparison against a
  narrower type, which would be a type error once the union shrinks);
- removes the corresponding branches in `ai-session-list.tsx`: the `'completed'` icon
  swap (line 116), the `'completed'`-vs-other badge tone branch (line 128, collapses
  to the existing running/waitingForUser check), `statusLabel`'s `'completed'` case
  (line 46, falls through to the existing default), and the "Aktualne"/"Zakończone"
  current/completed list split (lines 234-235) — which becomes meaningless once
  `'completed'` can never match, so the list renders as one flat, ungrouped list
  instead of two sections where one can never contain anything.
- `ai-session-list.tsx` is in this task's `allowed_paths` **narrowly for this
  purpose** — general sidebar work (row density, dedupe) remains
  `ux-improvements-version-1`'s `dedupe-recent-sessions` task (D8); if that task is
  in flight at the same time, coordinate rather than let both restyle the same lines
  independently.

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
2. No UI element claims a session-level "completed" or "failed" activity state —
   Session Activity (header/composer status indicator) only ever displays
   `idle`/`running`/`waitingForUser`; "completed"/"failed" are rendered as Turn/Work
   Outcome (in Work/history) instead. The dead `session.status === 'completed'` checks
   in `ai-chat.tsx` and `ai-session-list.tsx` are removed (see "Corrected vocabulary"
   above), not merely left inert.
   `inspection: confirm the header/composer status indicator only ever shows idle/running/waitingForUser, and that no code checks session.status === 'completed'/'failed' anywhere`
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
   `inspection: diff tools/dashboard/src/lib/types.ts's AgentToolCall union — confirm no member added`
8. `AiSessionStatus` is narrowed to exactly `'idle' | 'running' | 'waitingForUser'`.
   `automated: npm --prefix tools/dashboard test` (a type-level test/assertion that the union has exactly these 3 members, or the TypeScript build itself failing to compile a `'completed'`/`'failed'` comparison against `AiSession['status']`)
9. `npm --prefix tools/dashboard run build` succeeds after the narrowing — i.e. no
   remaining code anywhere in the dashboard still compares `session.status` (or any
   `AiSessionStatus`-typed value) against `'completed'`/`'failed'`, which the type
   change would otherwise surface as a compile error.
   `automated: npm --prefix tools/dashboard run build`
10. `ai-chat.tsx`'s composer disable/relabel logic (previously gated in part by
    `session?.status === 'completed'`) still behaves correctly for the conditions that
    remain meaningful (provider unavailable, load error, running state) — the removed
    clause is confirmed to have been dead (always false) by inspecting it before
    deletion, not assumed.
    `automated: npm --prefix tools/dashboard test`
11. `ai-session-list.tsx` renders session rows as a single list — the
    "Aktualne"/"Zakończone" split is removed since it can no longer produce a
    non-empty "Zakończone" group; `statusLabel` no longer has a `'completed'` case.
    `automated: npm --prefix tools/dashboard test`

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
- Any `ai-session-list.tsx` change beyond removing the dead `'completed'`/`'failed'`
  branches and the current/completed split that existed only to support them — row
  density, dedupe, and other sidebar restructuring stay
  `ux-improvements-version-1`'s `dedupe-recent-sessions` task.
- Re-deriving a "session completed" concept by any other means (e.g. from
  `completedAt`, from the absence of an active turn, etc.) — Session Activity stays
  exactly `idle | running | waitingForUser`; a finished turn's outcome is Turn/Work
  Outcome, displayed in Work/history, not as a session-level state.
