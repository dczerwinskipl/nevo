---
id: chat-ux-improvements-pt1.per-turn-work-presentation
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
    - tools/dashboard/src/components/ai-tool-view.tsx
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/chat-ux-improvements-pt1/tasks/01-semantic-chat-presentation-model.md
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/work/**
  - tools/dashboard/src/components/ui/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Introduce per-turn Work presentation

## Goal

Replace one-card-per-tool-call rendering with compact Work, consuming Task 01's
Conversation/Work projection. Today, `message.toolCalls?.map(...)` renders one
independent `AiToolView` card per call (`ai-chat.tsx:62-64`) with no grouping — a
12-tool turn produces 12 full-size cards.

## Implementation constraints

- Build a new `WorkSummary` component (module-level, per
  `react-component-guidelines.md` §20.1) consuming Task 01's per-turn Work
  view-model — do not re-derive current/completed/failed grouping inside this
  component's JSX (§6, §9.2: the projection already did that work in Task 01).
- Running state: one current activity as the primary line; previously-completed
  activity summarized compactly; new current activity replaces the previous one (does
  not grow the transcript indefinitely).
- Completed state: a successful sequence collapses to one compact summary (e.g.
  "Work · 8 actions ✓"), expandable to inspect individual actions via the existing
  `AiToolView` expand pattern.
- Failure visibility (FR-4, reinforced by `owner-decisions.md` D6, decided Option A):
  if any activity in the group is `'failed'` — including a tool that never received a
  real successful completion before its turn ended abnormally, per Task 01's D6 fix
  (this task consumes the corrected status Task 01's projection produces, it does not
  re-derive one) — the collapsed summary must visibly indicate attention is needed. It
  must not be presented as a uniform success summary. The failed action remains
  individually inspectable even while the rest of the group is collapsed.
- Do not invent new provider states beyond what Task 01's projection already
  distinguishes (FR-4). Turn/Work Outcome (successful/failed/cancelled) is a distinct
  concept from per-tool status — see `owner-decisions.md` D9; this component displays
  whichever of the two Task 01 actually exposes for a given activity, it does not
  blend them.
- Work associates with the relevant assistant turn per Task 01's documented
  correlation — do not merge Work from unrelated turns where the data can distinguish
  them.
- View-model update boundaries: the "current activity" line updates frequently during
  streaming; the "N completed" summary changes far less often. Per
  `react-component-guidelines.md` §9.1, do not force both into one object that both a
  low-frequency summary consumer and a high-frequency current-activity consumer
  subscribe to identically if it causes avoidable re-renders of the collapsed summary
  on every token.

## Acceptance criteria

1. A turn producing multiple successful tool calls renders as one compact Work
   summary, not one card per call.
   `inspection: run/simulate a turn with 5+ successful tool calls, confirm one Work row, not five cards`
2. While running, one current activity is the primary visible line; prior completed
   activity is compact; a new tool replaces the current slot rather than appending
   another full card.
   `inspection: simulate a running turn with 2+ sequential tool calls, observe the current slot swap`
3. Completed Work is expandable to inspect all individual actions.
   `automated: npm --prefix tools/dashboard test`
4. Collapsed state exposes a meaningful action count/status (e.g. "N actions").
   `inspection: verify the collapsed label reflects the actual count`
5. A failed action (including abrupt-termination per D6) is visibly flagged in the
   collapsed summary and remains individually inspectable.
   `automated: npm --prefix tools/dashboard test`
6. Work from unrelated turns is not merged where Task 01's projection can distinguish
   them.
   `inspection: simulate two sequential turns each with tool calls, confirm two separate Work groups`
7. Dozens of successful tool events do not dominate the mobile transcript (matches
   brief Scenario A: 12 actions → ~1 compact Work row on mobile).
   `inspection: simulate 12 successful tool events, check the rendered height/row count at a narrow viewport`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Human-readable per-tool labels — Task 04 (this task may still ship with raw
  `toolName`, Task 04 replaces it with normalized labels).
- Scroll/streaming stability of the Work region — Task 08.
