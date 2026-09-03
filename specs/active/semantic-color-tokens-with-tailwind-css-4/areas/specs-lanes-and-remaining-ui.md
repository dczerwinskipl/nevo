# Area: specs-lanes-and-remaining-ui

## Responsibility

Migrate `features/specifications/**` (including workflow lane presentation),
`features/pull-requests/**`, `features/operations/**`, and any remaining
`-[var(--…)]`/raw-white-black/`color-mix(...)` occurrence elsewhere in
`tools/dashboard/ui` not already covered by Areas 2-4, and replace the `--lane-accent`
runtime CSS-variable indirection with the static lane→token mapping from the change
request.

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
- `specification-list.tsx:66` — `text-[var(--accent)] group-hover:text-[var(--accent-strong)]`
  icon hover (same D4 fix as `status-card.tsx` in Area 2 — this file wasn't migrated
  there because it's under `features/`, not `components/ui/`).
- `specification-sidebar.tsx:51,60,218` — active-nav-item and focus-ring `color-mix`
  recipes; `:115,189,205` — `bg-black/60`, `bg-black/20` raw usages.
- Repeated `color-mix(in_srgb,var(--danger)_20%,transparent)`/`_8%,10%` error-banner
  recipe and `color-mix(in_srgb,var(--warning)_20%,transparent)`/`_8%` warning-banner
  recipe across `spec-actions.tsx:72-73,76,198,212`,
  `operation-progress.tsx:34,67,116,151`, `pull-request-detail.tsx:255`,
  `pull-request-cards.tsx:52,54`, `agent-session-list.tsx:148` (the last is Area 4's
  file — if Area 4 lands first, this task only needs to confirm it, not redo it).
  `create-specification-error-banner.tsx:41` — `color-mix(in_srgb,var(--warning-strong)_90%,transparent)`
  muted-warning text (same duplicated recipe family as Area 4's
  `create-agent-session-dialog.tsx:262`).
- Repeated `color-mix(in_srgb,var(--accent)_8%,transparent)` selected-pill recipe also
  appears in `specification-metadata-fields.tsx:94`,
  `specification-ai-planning-section.tsx:87,122` (same family as Area 4's).
- Provider/category and other stray white/black or `-[var(--…)]` occurrences may exist
  elsewhere in the tree beyond the files named here (the 58-file/1003-occurrence and
  27-file/59-occurrence counts in `overview.md` include files not individually profiled
  by discovery) — this area's task is responsible for sweeping every remaining
  occurrence anywhere in `tools/dashboard/ui` once Areas 2-4 are done, since it is the
  last consumer-migration area before cleanup.

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
- `specification-list.tsx:66`: apply the same D4 hover-contrast fix as `status-card.tsx`
  (stop using `accent-strong`/`accent-solid` as hover text color).
- Collapse every duplicated `color-mix(...)` recipe family (error-banner, warning-banner,
  selected-pill, muted-warning-text) into opacity-modifier utilities consistent with how
  Areas 2 and 4 resolved the same families — do not invent a third convention for the
  same recipe.
- After this task, run one repo-wide sweep grep for `-[var(--`, raw white/black, and
  `color-mix(` across all of `tools/dashboard/ui` (not just the features named above) and
  fix any remaining occurrence found — this area is the last consumer-migration area
  before `areas/cleanup-and-enforcement.md`'s final verification.

## Constraints

- Depends on `areas/shared-ui-primitives.md` and `areas/status-tone-contract.md`
  (renders through Button/Badge/StatusCard/status-tone module); for the lane mapping,
  also depends on the status-tone module's `status-info`/`status-active`/
  `status-warning`/`status-success` token names being final.
- No visual change to lane colors — new→neutral etc. is a naming/mechanism change (from
  `--lane-*` values to canonical status-token values), not a repaint; if any lane's
  numeric color would change under the new mapping (e.g. `--lane-ready` is currently
  `var(--info)` and maps to `status-info`, so should be unchanged — verify each of the 6
  lanes individually rather than assuming).

## Interfaces and boundaries

- Consumes: `areas/theme-foundation.md` tokens, `areas/shared-ui-primitives.md`
  primitives, `areas/status-tone-contract.md` module.
- Produces: nothing consumed by other areas (leaf features).

## Area-specific acceptance criteria

1. Zero `-[var(--` occurrences remain under `features/specifications/**`,
   `features/pull-requests/**`, `features/operations/**`.
2. Zero raw `bg/text/border-white|black` occurrences remain in those directories.
3. Zero `color-mix(...)` occurrences remain in those directories.
4. `lane-presentation.ts` returns no `var(--lane-*)` string; `status-board.tsx` contains
   no `'--lane-accent'` inline-style assignment.
5. Each of the 6 lane states renders with the exact token specified in the change
   request's mapping table, verified against the previous rendered color for parity
   where the mapping implies no change.
6. A repo-wide sweep (`grep -r -- "-\[var(--" tools/dashboard/ui`, equivalent for
   white/black and `color-mix`) returns zero results outside Storybook
   stories/tests/fixtures and any explicitly documented exception.
7. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook` all pass.
8. Specifications/PR/operations Storybook stories show no unintended visual change
   (screenshot comparison), except the explicit `specification-list.tsx` hover fix.

## Dependencies

`areas/shared-ui-primitives.md`, `areas/status-tone-contract.md`. Should run after (or
at least alongside, with careful recipe-naming coordination) `areas/agent-sessions-and-work.md`
since several `color-mix` recipe families are shared between the two areas' files.

## Out of scope

- Removing `--lane-*`/other old `:root` variables, `--color-*: initial`, the
  `theme-color` meta fix, and the architecture-check itself —
  `areas/cleanup-and-enforcement.md`.
