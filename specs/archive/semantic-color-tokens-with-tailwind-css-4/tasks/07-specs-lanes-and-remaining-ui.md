---
id: semantic-color-tokens-with-tailwind-css-4.specs-lanes-and-remaining-ui
status: in-implementation
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/specs-lanes-and-remaining-ui.md
    - docs/development/react-component-guidelines.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - docs/development/nevo-interaction-model.md
    - docs/development/storybook.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/shared/status-tone.ts
    - tools/dashboard/ui/features/specifications/detail/lane-presentation.ts
    - tools/dashboard/ui/features/specifications/detail/status-board.tsx
allowed_paths:
  - tools/dashboard/ui/**
  - tools/dashboard/tests/**
  - tools/dashboard/.storybook/**
forbidden_paths:
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
  - agent-sessions-and-work
semantic_references:
  decisions: [D2, D3, D4, D8, D9, D11, D12, D13]
  constraints: [C5, C7, C8]
---

# Task: Migrate specifications/lanes/PRs/operations, refine status presentation boundary, add diff tokens, and co-locate stories

## Goal

Migrate `features/specifications/**` (including replacing the `--lane-accent` runtime
indirection with the static lane→token mapping), `features/pull-requests/**`,
`features/operations/**` to semantic utilities, apply the D4 hover fix to
`specification-list.tsx`, and sweep the rest of `tools/dashboard/ui` for any remaining
`-[var(--…)]`/raw-white-black/`color-mix(...)` occurrence not covered by earlier tasks.

Scope expansion:
1. Refactor `StatusLabel` (`tools/dashboard/ui/shared/ui/status-label.tsx`) to be purely
   presentational (`tone: StatusTone` required, rendered `children`, no domain awareness,
   remove deprecated `statusTone()`).
2. Add `--color-diff-addition` and `--color-diff-deletion` to `index.css` `@theme static inline`
   emitting `text-diff-addition` and `text-diff-deletion`. Migrate additions/deletions in
   file-change and PR components. Audit lifecycle-state vs interaction uses of `accent` ->
   migrate running/in-progress indicators to `status-active`.
3. Reorganize Storybook stories: delete omnibus `shared-primitives.stories.tsx`, co-locate
   stories beside their primitives (`button`, `badge`, `card`, `dialog`, `sheet`, `status-card`,
   `progress`, `loading-screen`), move delete-session scenario to
   `features/agent-sessions/agent-session-details.stories.tsx`, split `specifications.stories.tsx`,
   relocate test helpers to `tools/dashboard/.storybook/test-utils/`.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`, `agent-sessions-and-work`.

## Implementation constraints

- `lane-presentation.ts`: replace the `{ accent: 'var(--lane-X)' }` shape with a static
  lookup implementing new→neutral, design→`workflow-design`, ready→`status-info`,
  implementation→`status-active`, review→`status-warning`, done→`status-success`.
- `status-board.tsx`: remove the `style={{ '--lane-accent': presentation.accent }}`
  inline-style assignment and the `bg-[var(--lane-accent)]` consumption — use static classes directly.
- `StatusLabel` presentation boundary:
  - Remove deprecated `statusTone(status: string)`.
  - Remove domain awareness (`kind`, `status`, session status literals, task formatting, stage formatting).
  - Public contract receives rendered `children` and a required typed `tone: StatusTone`.
  - Move domain-status-to-tone mappings and formatting into their owning feature modules (`features/specifications/status.ts`, `features/agent-sessions/`, etc.).
  - Non-status labels (such as workflow lane names) must not use `StatusLabel` merely to reuse uppercase typography; use local semantic markup.
  - Remove commented obsolete JSX in `agent-session-list.tsx` and brittle tests matching raw strings.
- Semantic role purity:
  - Add `--color-diff-addition: var(--color-status-success);` and `--color-diff-deletion: var(--color-status-error);` to `index.css` `@theme static inline`.
  - Migrate additions/deletions in `file-change.tsx`, `pull-request-detail.tsx`, `pull-request-cards.tsx` to `text-diff-addition` and `text-diff-deletion`.
  - Audit lifecycle-state uses of `accent`: migrate running/in-progress indicators (session running badge, operation running rows, spec implementation stage) to `status-active`.
- Storybook co-location & test utils:
  - Delete `components/ui/shared-primitives.stories.tsx`.
  - Co-locate stories beside primitives (`button.stories.tsx`, `badge.stories.tsx`, etc.).
  - Move delete-session scenario to `features/agent-sessions/agent-session-details.stories.tsx`.
  - Split `specifications.stories.tsx` into `status-board.stories.tsx`, `specification-list.stories.tsx`, `pull-request-cards.stories.tsx`, `operation-progress.stories.tsx`.
  - Move Storybook test helpers to `tools/dashboard/.storybook/test-utils/`.
  - Use `Meta<typeof Component>` and `StoryObj<typeof meta>`.
  - Remove copied production palette assertions from `LiveTokenResolver`.

## Acceptance criteria

1. Zero `-[var(--` occurrences remain under `features/specifications/**`,
   `features/pull-requests/**`, `features/operations/**`.
2. Zero raw `bg/text/border-white|black` occurrences remain in those directories.
3. Zero `color-mix(...)` occurrences remain in those directories.
4. `lane-presentation.ts` contains no `var(--lane-*)` string; `status-board.tsx`
   contains no `'--lane-accent'`.
5. `StatusLabel` is purely presentational: requires typed `tone: StatusTone`, receives rendered
   children, has no `kind` or `status` prop, and `statusTone(string)` is completely removed.
6. Diff additions and deletions use `text-diff-addition` and `text-diff-deletion` rather than
   `status-success`/`status-error`.
7. Active running lifecycle indicators use `status-active` rather than `accent`.
8. Primitive stories are co-located with their components, delete-session scenario is in
   agent-session details story, specification stories are split, and test helpers reside in
   `tools/dashboard/.storybook/test-utils/`.
9. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook`, `npm --prefix tools/dashboard run build-storybook` pass.

## Verification

```text
npm --prefix tools/dashboard run format:check
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Documentation impact

None yet — `tasks/08-storybook-and-documentation.md`.

## Out of scope

- Removing old `:root` variables, `--color-*: initial`, `theme-color` meta fix, the
  architecture check — `tasks/09-*`, `tasks/10-*`.

