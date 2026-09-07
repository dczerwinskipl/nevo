# Area: specs-lanes-and-remaining-ui

## Responsibility

Migrate `features/specifications/**` (including workflow lane presentation),
`features/pull-requests/**`, `features/operations/**`, and any remaining
`-[var(--…)]`/raw-white-black/`color-mix(...)` occurrence elsewhere in
`tools/dashboard/ui` not already covered by Areas 2-4, and replace the `--lane-accent`
runtime CSS-variable indirection with the static lane→token mapping from the change
request.

Additionally, this area owns:
- Refactoring `StatusLabel` (`tools/dashboard/ui/shared/ui/status-label.tsx`) into a purely
  presentational primitive with typed `tone: StatusTone` and rendered children, removing domain
  awareness, `kind`, `status`, and the deprecated `statusTone()` function. Feature modules
  own their status projections.
- Introducing dedicated diff statistics semantic roles (`--color-diff-addition` and
  `--color-diff-deletion`), emitting `text-diff-addition` and `text-diff-deletion`, and migrating
  additions/deletions in file-change and pull-request components.
- Auditing lifecycle-state presentation to use `status-active` for running/in-progress states
  (session running badges, operation running rows, spec implementation stage) instead of `accent`.
- Reorganizing Storybook stories: deleting the omnibus `shared-primitives.stories.tsx`, co-locating
  stories beside individual shared primitives, moving the delete-session scenario to
  `features/agent-sessions/agent-session-details.stories.tsx`, splitting `specifications.stories.tsx`
  by owning components, and relocating test helpers from `components/ui/` to
  `tools/dashboard/.storybook/test-utils/`.

## Current state

- High-density specifications files: `features/specifications/navigation/specification-sidebar.tsx`
  (~44 occurrences, lines 49-248), `features/specifications/actions/spec-actions.tsx`
  (~38), `features/specifications/list/specification-list.tsx`,
  `features/specifications/detail/overview-panel.tsx`,
  `features/specifications/detail/status-board.tsx`,
  `features/specifications/create/specification-metadata-fields.tsx`,
  `features/specifications/create/specification-ai-planning-section.tsx`,
  `features/specifications/create/create-specification-error-banner.tsx`,
  `features/specifications/specification-console-layout.tsx`.
- Workflow lane runtime indirection: `lane-presentation.ts:7-14` maps each `StageId` to
  `{ accent: 'var(--lane-X)' }`; `status-board.tsx:119,125,129` sets
  `style={{ '--lane-accent': presentation.accent }}` per render, then consumes it via
  `bg-[var(--lane-accent)]`.
- `StatusLabel` boundary: `status-label.tsx` contains domain-specific knowledge (session, spec,
  task, and stage formatting), plus a deprecated `statusTone()` function. Some callers use
  it merely for uppercase styling.
- Diff statistics in `file-change.tsx`, `pull-request-detail.tsx`, `pull-request-cards.tsx`
  currently use `status-success`/`status-error` instead of dedicated diff tokens.
- Lifecycle indicators in session headers, operations, and spec stages use `accent` instead
  of `status-active`.
- Storybook stories for primitives are bundled into one monolithic file (`shared-primitives.stories.tsx`)
  and specification stories are bundled into `specifications.stories.tsx`. Test helpers live in
  `components/ui/storybook-test-helpers.ts` instead of `.storybook/test-utils/`.

## Requirements

- Replace every `-[var(--…)]`, raw white/black, and `color-mix(...)` occurrence under
  `features/specifications/**`, `features/pull-requests/**`, `features/operations/**`
  with semantic utilities, per the same conventions as Areas 2 and 4.
- `lane-presentation.ts`: change its return shape from a CSS-variable string to
  something a static class-name lookup can consume directly (e.g. a lane→token-name map
  or a lane→Tailwind-class-string map) implementing exactly: new→neutral,
  design→`workflow-design`, ready→`status-info`, implementation→`status-active`,
  review→`status-warning`, done→`status-success`.
  `status-board.tsx`: remove the `style={{ '--lane-accent': … }}` inline-style
  indirection; consume the static classes directly.
  `--lane-*` CSS variables (`index.css:42-48`) become unused by this migration (their
  removal is `areas/cleanup-and-enforcement.md`'s job, not this task's).
- `StatusLabel` presentation boundary:
  - Remove deprecated `statusTone(status: string)`.
  - Remove all domain awareness from `StatusLabel` (`kind`, `status`, session status literals, task formatting, stage formatting).
  - Its public contract receives rendered `children` and a required typed `tone: StatusTone`.
  - Move domain-status-to-tone mappings and formatting into their owning feature modules (`features/specifications/status.ts`, `features/agent-sessions/`, etc.).
  - Update every current `StatusLabel` call site.
  - Non-status labels (e.g. workflow lane names) must use local semantic markup (`span` with uppercase typography), not `StatusLabel`.
  - Remove commented obsolete JSX in `agent-session-list.tsx` and brittle tests matching raw strings.
- Semantic role purity:
  - Add `--color-diff-addition: var(--color-status-success);` and `--color-diff-deletion: var(--color-status-error);` to `index.css` `@theme static inline`, emitting `text-diff-addition` and `text-diff-deletion`.
  - Migrate additions/deletions in `file-change.tsx`, `pull-request-detail.tsx`, `pull-request-cards.tsx` to use `text-diff-addition`/`text-diff-deletion`.
  - Audit clear lifecycle-state uses of `accent` -> migrate to `status-active` for session running badges, operation running rows, and specification implementation stages.
- Storybook co-location and architecture:
  - Delete `components/ui/shared-primitives.stories.tsx`.
  - Co-locate stories with their component: `button.stories.tsx`, `badge.stories.tsx`, `card.stories.tsx`, `dialog.stories.tsx`, `sheet.stories.tsx`, `status-card.stories.tsx`, `progress.stories.tsx`, `loading-screen.stories.tsx` (beside `shared/ui/loading-screen.tsx`).
  - Move delete-session scenario to `features/agent-sessions/agent-session-details.stories.tsx`.
  - Split `features/specifications/specifications.stories.tsx` by component: `status-board.stories.tsx`, `specification-list.stories.tsx`, `pull-request-cards.stories.tsx`, `operation-progress.stories.tsx`.
  - Move Storybook test helpers to `tools/dashboard/.storybook/test-utils/`.
  - Use `Meta<typeof Component>` and `StoryObj<typeof meta>`.
  - Remove copied production palette assertions from `LiveTokenResolver`.

## Area-specific acceptance criteria

1. Zero `-[var(--` occurrences remain under `features/specifications/**`,
   `features/pull-requests/**`, `features/operations/**`.
2. Zero raw `bg/text/border-white|black` occurrences remain in those directories.
3. Zero `color-mix(...)` occurrences remain in those directories.
4. `lane-presentation.ts` returns no `var(--lane-*)` string; `status-board.tsx` contains
   no `'--lane-accent'` inline-style assignment.
5. Each of the 6 lane states renders with the exact token specified in the change
   request's mapping table.
6. `StatusLabel` is purely presentational: requires typed `tone: StatusTone`, receives rendered
   children, has no `kind` or `status` prop, and `statusTone(string)` is completely removed.
7. Diff additions and deletions use `text-diff-addition` and `text-diff-deletion` rather than
   `status-success`/`status-error`.
8. Active running lifecycle indicators use `status-active` rather than `accent`.
9. Primitive stories are co-located with their components, delete-session scenario is in
   agent-session details story, specification stories are split, and test helpers reside in
   `tools/dashboard/.storybook/test-utils/`.
10. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
    `npm --prefix tools/dashboard run test:storybook`, `npm --prefix tools/dashboard run build-storybook` all pass.


## Dependencies

`areas/shared-ui-primitives.md`, `areas/status-tone-contract.md`. Should run after (or
at least alongside, with careful recipe-naming coordination) `areas/agent-sessions-and-work.md`
since several `color-mix` recipe families are shared between the two areas' files.

## Out of scope

- Removing `--lane-*`/other old `:root` variables, `--color-*: initial`, the
  `theme-color` meta fix, and the architecture-check itself —
  `areas/cleanup-and-enforcement.md`.
