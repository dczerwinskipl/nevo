---
id: storybook-for-nevo-ai.storybook-documentation
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/areas/documentation.md
    - docs/development/react-component-guidelines.md
  optional:
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
allowed_paths:
  - docs/development/storybook.md
  - docs/development/react-component-guidelines.md
  - docs/index.generated.json
  - docs/index.generated.md
forbidden_paths:
  - tools/dashboard/ui/**
  - tools/dashboard/server/**
  - src/**
depends_on:
  - chat-fixture-model
  - foundation-stories
  - chat-stories-empty-and-waiting
  - chat-stories-conversation-and-work
  - chat-stories-active-states
semantic_references:
  decisions: []
  constraints: []
  dependency_contracts:
    - chat-fixture-model
    - foundation-stories
    - chat-stories-empty-and-waiting
    - chat-stories-conversation-and-work
    - chat-stories-active-states
---

# Task: Storybook documentation

## Goal

Write `docs/development/storybook.md` documenting how to start/build Storybook, the story
hierarchy, fixture reuse, when to use Args vs. providers/decorators vs. network mocking, the
full validation workflow, and how an agent selects/verifies a story before declaring UI work
complete — describing what tasks 03-09 actually built, not aspirational behavior.

## Dependencies

- `chat-fixture-model` (06) — this task's own acceptance criterion 3 documents the real
  scenario builder module path task 06 produces; it cannot be written correctly without
  task 06 complete.
- `foundation-stories` (05), `chat-stories-empty-and-waiting` (07),
  `chat-stories-conversation-and-work` (08), `chat-stories-active-states` (09) — needs their
  final, real script names/paths/patterns to document accurately.

## Implementation constraints

- Use `tools/docs.mjs`'s required front-matter fields for `type: development` exactly
  (`id`, `type`, `title`, `status`, `read_when`, `summary`, `related`).
- Link to, rather than duplicate, rules already owned by
  `docs/development/nevo-ai-ux-guidelines.md` / `docs/development/ui-ux-guidelines.md`.
- Add a cross-link from `docs/development/react-component-guidelines.md`'s existing RTL
  testing line (§10) noting that Vitest+RTL is now wired, and where.

## Acceptance criteria

1. `node tools/docs.mjs validate` passes for the new/updated documents.
   `automated: node tools/docs.mjs validate`
2. The documented `npm run storybook`/`build-storybook`/`test:storybook` commands match the
   actual script names in `tools/dashboard/package.json`.
   `inspection: diff documented commands against package.json scripts`
3. The documented fixture-reuse instructions reference the actual module path from task 06.
   `inspection: confirm the referenced path exists`
4. The documented agent-verification workflow matches `overview.md` § "Verification
   strategy" exactly. `inspection: diff the two sections`
5. `node tools/docs.mjs generate` has been run and `docs/index.generated.*` reflect the new
   document. `automated: node tools/docs.mjs check`
6. The documented story hierarchy and naming conventions (`Foundations/*`, `Components/*`,
   `Patterns|Features/*`, `Screens/*` or whatever tasks 03/05/07-09 actually converged on)
   match every story's real Storybook `title` as implemented — not an aspirational
   hierarchy that diverges from what was actually built.
   `inspection: enumerate each *.stories.tsx file's title and confirm it matches the documented convention`

## Verification

```text
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task's entire output is documentation.

## Out of scope

- Any new architectural decision.
