---
id: chat-ux-improvements-pt1.streaming-and-scroll-behavior
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model, per-turn-work-presentation]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/lib/use-scroll-follow.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Fix streaming and scroll behavior

## Goal

Make streaming respect user reading position (FR-24/FR-25). Today, auto-scroll is
unconditional: a `useEffect` calls `transcriptRef.current?.scrollTo({ top:
scrollHeight, behavior: 'smooth' })` on every `assistant.messages`/`pendingInteraction`/
`submissionError` change (`ai-chat.tsx:193-195`) with no near-bottom check — a user who
has scrolled up to read history gets yanked back down on the next token/tool event.

## Implementation constraints

- Extract a `useScrollFollow`-style hook (module-level, testable in isolation per
  `react-component-guidelines.md` §7/§8: this is exactly the kind of logic that
  shouldn't live as an ad hoc effect inline in `AiChatPage`).
- Track "near bottom" via `distanceFromBottom = scrollHeight - scrollTop - clientHeight`
  against a threshold, not an unconditional scroll.
- When near bottom: new content may auto-follow. When the user has scrolled up:
  auto-follow pauses; incoming tokens/tool events do not pull the viewport down.
- A compact affordance (e.g. "↓ Agent replied") appears when new content exists and
  follow is paused; activating it returns to latest content and resumes follow.
- Current Work activity (Task 03) updates within a stable region — completed
  activities moving into history must not cause large layout jumps; expanding/
  collapsing Work stays user-controlled, never auto-triggered by new events.
- Remove the unconditional per-event `scrollIntoView`/`scrollTo` call this task
  replaces — no path in the new implementation still force-scrolls on every event.
- Preserve the existing keyboard-open viewport-adjustment effect
  (`ai-chat.tsx:197-201`) and composer-focus scroll behavior
  (`ai-chat.tsx:445-450`) unless they conflict with the new follow logic — if they do,
  reconcile explicitly rather than leaving two competing scroll mechanisms.

## Acceptance criteria

1. At/near bottom, new content auto-follows.
   `automated: npm --prefix tools/dashboard test`
2. Scrolling upward pauses auto-follow.
   `automated: npm --prefix tools/dashboard test`
3. Incoming tokens/tool events do not pull the user back to the bottom while
   auto-follow is paused.
   `automated: npm --prefix tools/dashboard test`
4. A compact new-content affordance appears while paused with unseen content.
   `inspection: scroll up during a simulated stream, confirm the affordance appears`
5. Activating the affordance returns to latest content and resumes follow.
   `automated: npm --prefix tools/dashboard test`
6. Current Work activity updates in a stable region without large layout jumps as
   activities complete.
   `inspection: observe a multi-step simulated turn, check for jarring reflow`
7. Work expansion/collapse remains user-controlled — no auto-expand/collapse on new
   events.
   `inspection: expand a completed Work group, confirm a subsequent new turn doesn't auto-collapse it`
8. No unconditional per-event `scrollIntoView()`/`scrollTo()` call remains in the
   codebase for this transcript.
   `inspection: grep ai-chat.tsx and the new hook for unconditional scroll calls`
9. Scroll interaction tests cover both the following and paused states.
   `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Virtualization — not introduced unless session-size profiling in Task 10 shows it's
  actually needed (NFR-3 explicitly does not require it by default).
