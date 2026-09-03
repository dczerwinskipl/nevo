---
id: storybook-for-nevo-ai.chat-stories-conversation-and-work
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/areas/chat-stories.md
    - tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__
    - docs/development/nevo-ai-ux-guidelines.md
  optional:
    - docs/development/ui-ux-guidelines.md
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

# Task: "Existing conversation" story

## Goal

Add the "Existing conversation" story: a representative user/assistant conversation with a
populated Work timeline covering commentary, command execution, file read, file write/edit,
search, representative completed states, grouped commands (if supported), and long content
sufficient to verify wrapping/truncation/spacing.

## Dependencies

- `chat-fixture-model` (task 06).

## Implementation constraints

- Preserve canonical chronology — do not reorganize Commentary/tool sequence into grouped
  sections that destroy temporal meaning (`docs/development/nevo-ai-ux-guidelines.md` §6).
- Commentary renders as prose, not an event row (§7); tool type is communicated by
  icon/label, state by color (§9.2).
- Expose the activity list as Storybook Args/Controls (editable object/array) using built-in
  Controls; if genuinely insufficient for the nested `WorkItemV2[]` shape, document the
  specific limitation before considering any alternative.
- Cover representative desktop and mobile viewports.

## Acceptance criteria

1. The story includes at least one instance each of: commentary, a command-execution tool,
   a file-read tool, a file-write/edit tool, and a search tool.
   `inspection: enumerate rendered activity kinds`
2. The story includes a grouped-commands example if the canonical model supports grouping,
   and long content (long command/path/commentary) that exercises wrapping/truncation
   without breaking layout. `inspection: render and confirm no layout overflow`
3. The activity list is editable via Storybook Controls and the timeline re-renders
   immediately on edit. `inspection: edit a Control value, confirm re-render`
4. The story renders without a live backend or AI provider and passes its
   `@storybook/addon-vitest` render test. `automated: npm --prefix tools/dashboard run test:storybook`
5. The story is inspected at desktop and mobile viewports.
   `inspection: Storybook viewport toolbar, both breakpoints checked`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Out of scope

- "Empty chat"/"Waiting for first activity" — task 07.
- "Active thinking"/"Active tool" — task 09.
