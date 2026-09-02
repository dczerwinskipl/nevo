---
id: storybook-for-nevo-ai.chat-stories-empty-and-waiting
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/areas/chat-stories.md
    - specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
    - tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__
  optional:
    - docs/development/nevo-ai-ux-guidelines.md
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/**/*.stories.tsx
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

# Task: "Empty chat" and "Waiting for first agent activity" stories

## Goal

Add the two deterministic chat stories: no conversation history with the correct empty
surface/composer state, and the user-message-submitted/turn-started/no-activity-yet state —
both frozen, no real timers.

## Dependencies

- `chat-fixture-model` (task 06).

## Implementation constraints

- Both states are frozen snapshots — no `setInterval`/`setTimeout`/pending promise driving
  the story's visible state.
- Use the fixture builders from task 06; do not hand-build a divergent object graph inline.
- Cover representative desktop and mobile viewports via Storybook viewport
  parameters/controls.

## Acceptance criteria

1. The "Empty chat" story renders no conversation history and the correct empty
   surface/composer state, matching `docs/development/nevo-ai-ux-guidelines.md` §4 (final
   answer / composer behavior expectations for an empty session).
   `inspection: render and compare against §4`
2. The "Waiting for first agent activity" story shows the user's submitted message, an
   active/started Turn state, and no commentary/tool/final-response content yet —
   frozen and deterministic on every render. `inspection: render twice, confirm identical output`
3. Both stories render without a live backend or AI provider.
   `automated: npm --prefix tools/dashboard run test:storybook`
4. Both stories are inspected at desktop and mobile viewports.
   `inspection: Storybook viewport toolbar, both breakpoints checked`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Out of scope

- The "Existing conversation", "Active thinking", and "Active tool" stories — tasks 08, 09.
