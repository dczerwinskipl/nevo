---
id: storybook-for-nevo-ai.chat-stories-active-states
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/areas/chat-stories.md
    - tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__
    - tools/dashboard/ui/features/agent-sessions/work-v2/use-elapsed-label.ts
  optional:
    - docs/development/nevo-ai-ux-guidelines.md
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.stories.tsx
forbidden_paths:
  - tools/dashboard/ui/features/agent-sessions/types.ts
  - tools/dashboard/server/**
  - src/**
depends_on:
  - chat-fixture-model
semantic_references:
  decisions: []
  constraints: [C5]
  dependency_contracts: [chat-fixture-model]
---

# Task: "Active thinking" and "Active tool" stories

## Goal

Add the two frozen "currently active" chat stories: commentary/thinking currently active,
and a tool currently running with the correct running indicator/intermediate styling —
both frozen for visual inspection, no real timer/agent process.

## Dependencies

- `chat-fixture-model` (task 06).

## Implementation constraints

- `useElapsedLabel` (`work-v2/use-elapsed-label.ts:17-30`) drives its label from a
  `startedAt` prop via a real `setInterval`; these stories must present a visually frozen
  state for inspection despite that timer existing in the component — e.g. by fixing
  `startedAt` in the fixture and treating the ticking label itself as acceptable
  (non-blocking) live behavior, not something to fight. Do not disable or fake the timer at
  the component level; that would diverge the story from production behavior.
- "Active thinking" must only be modeled if the canonical model has real reasoning/commentary
  evidence for it — do not invent a `Thinking` state without canonical evidence
  (`docs/development/nevo-ai-ux-guidelines.md` §2.2).
- Cover representative desktop and mobile viewports.

## Acceptance criteria

1. The "Active thinking" story shows commentary/reasoning presented as currently active,
   using real canonical evidence fields (not a synthetic "Thinking" label with no backing
   data). `inspection: confirm fixture carries genuine commentary/reasoning evidence`
2. The "Active tool" story shows one tool in a running state with the correct running
   indicator and intermediate styling, distinguishable from a completed tool.
   `inspection: visually compare running vs. completed tool rendering`
3. Both stories render without a live backend or AI provider and pass their
   `@storybook/addon-vitest` render test. `automated: npm --prefix tools/dashboard run test:storybook`
4. Both stories are inspected at desktop and mobile viewports.
   `inspection: Storybook viewport toolbar, both breakpoints checked`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Out of scope

- "Empty chat"/"Waiting for first activity" — task 07.
- "Existing conversation" — task 08.
