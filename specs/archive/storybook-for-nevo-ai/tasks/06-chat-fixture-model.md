---
id: storybook-for-nevo-ai.chat-fixture-model
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/areas/chat-stories.md
    - specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
    - tools/dashboard/ui/features/agent-sessions/types.ts
    - tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__/**
  - tools/dashboard/ui/features/agent-sessions/**/*.fixtures.ts
  - tools/dashboard/tests/chat-fixture-model.test.tsx
forbidden_paths:
  - tools/dashboard/ui/features/agent-sessions/types.ts
  - tools/dashboard/server/**
  - src/**
depends_on:
  - chat-surface-extraction
  - component-testing-infrastructure
semantic_references:
  decisions: [D2]
  constraints: [C5]
  dependency_contracts: [chat-surface-extraction]
---

# Task: Typed chat fixture/scenario builder module

## Goal

Build a reusable, typed fixture/scenario builder module over `CanonicalTurnV2`/`WorkItemV2`
(`features/agent-sessions/types.ts`) that the five required chat stories (tasks 07-09) build
on, so no large object graph is duplicated across stories.

## Dependencies

- `chat-surface-extraction` (task 02) — needs the final composition point to target.
- `component-testing-infrastructure` (task 04) — needs Vitest/RTL available for this
  module's own unit tests.

## Implementation constraints

- Use the canonical UI-facing model only — never raw Claude/Codex/Antigravity protocol
  payloads (change-wide constraint C5).
- The `WorkItemV2` fixture shape already hand-built in
  `tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs:210-224` is a useful
  starting reference — reuse its shape rather than inventing a divergent one, but do not
  import from a `.test.mjs` file; build the canonical module fresh under
  `work-v2/__fixtures__/`.
- `types.ts` is read-only for this task (`forbidden_paths`) — if the fixture model reveals a
  genuine gap in the canonical types, report it as an open question rather than editing the
  canonical types unilaterally.
- Commentary must be modeled as its own canonical activity kind, never coerced into a tool
  shape merely for fixture convenience (`docs/development/nevo-ai-ux-guidelines.md` §7).

## Acceptance criteria

1. The module exports typed builder functions covering: a user message, an assistant final
   answer, commentary, a running/completed/failed tool of each represented kind (command
   execution, file read, file write/edit, search), and a grouped-commands scenario (if the
   canonical model supports grouping). `inspection: enumerate exported builders against this list`
2. At least one builder produces long content (long command/path/commentary) sufficient to
   exercise wrapping/truncation in a later story. `inspection: confirm a long-content builder exists`
3. The module has its own unit tests (pure function tests, no rendering needed) confirming
   each builder produces a value conforming to its declared type.
   `automated: npm --prefix tools/dashboard run test:storybook`
4. No object literal from this module is duplicated verbatim in a consuming story file —
   consuming stories call the builders. `inspection: grep consuming stories for inline duplicate literals once tasks 07-09 land`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
```

## Out of scope

- The stories themselves — tasks 07, 08, 09.
- Any change to `types.ts`.
