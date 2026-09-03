---
id: semantic-color-tokens-with-tailwind-css-4.specs-lanes-and-remaining-ui
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/specs-lanes-and-remaining-ui.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/shared/status-tone.ts
    - tools/dashboard/ui/features/specifications/detail/lane-presentation.ts
    - tools/dashboard/ui/features/specifications/detail/status-board.tsx
allowed_paths:
  - tools/dashboard/ui/**
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/shared/status-tone.ts
  - tools/dashboard/ui/features/agent-sessions/**
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
  - agent-sessions-and-work
semantic_references:
  decisions: [D2, D3, D4]
  constraints: [C5]
---

# Task: Migrate specifications/lanes/PRs/operations and sweep remaining UI

## Goal

Migrate `features/specifications/**` (including replacing the `--lane-accent` runtime
indirection with the static lane→token mapping), `features/pull-requests/**`,
`features/operations/**` to semantic utilities, apply the D4 hover fix to
`specification-list.tsx`, and sweep the rest of `tools/dashboard/ui` for any remaining
`-[var(--…)]`/raw-white-black/`color-mix(...)` occurrence not covered by earlier tasks.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`, `agent-sessions-and-work` (shared
`color-mix` recipe families should be resolved consistently with how that task resolved
them).

## Implementation constraints

- `lane-presentation.ts`: replace the `{ accent: 'var(--lane-X)' }` shape with a static
  lookup implementing new→neutral, design→`workflow-design`, ready→`status-info`,
  implementation→`status-active`, review→`status-warning`, done→`status-success`.
- `status-board.tsx`: remove the `style={{ '--lane-accent': presentation.accent }}`
  inline-style assignment (lines 119, 125, 129) and the `bg-[var(--lane-accent)]`
  consumption — use the static classes directly.
- `specification-list.tsx:66`: same hover-contrast fix as `status-card.tsx` in
  `tasks/02-*` (stop using `accent-strong`/`accent-solid` as hover text color).
- Resolve the error-banner, warning-banner, selected-pill, and muted-warning-text
  `color-mix` recipe families the same way `tasks/04-*` resolved them in
  `create-agent-session-dialog.tsx`/`interaction-prompt.tsx`/`provider-unavailable-banner.tsx`
  — consistent opacity-modifier naming across both tasks.
- After the named directories are migrated, grep the rest of `tools/dashboard/ui`
  (excluding `*.stories.tsx`, `tests/`, `__fixtures__/`) for `-[var(--`, raw
  white/black, and `color-mix(` and fix any remaining occurrence — this is the last
  consumer-migration task before `tasks/07-*` removes the old variables.
- Do not touch `index.css`, `components/ui/**`, `shared/status-tone.ts`, or
  `features/agent-sessions/**`.

## Acceptance criteria

1. Zero `-[var(--` occurrences remain under `features/specifications/**`,
   `features/pull-requests/**`, `features/operations/**`.
   `automated: ! grep -rq -- "-\[var(--" tools/dashboard/ui/features/specifications tools/dashboard/ui/features/pull-requests tools/dashboard/ui/features/operations`
2. Zero raw `bg/text/border-white|black` occurrences remain in those directories.
   `automated: ! grep -rqE "bg-(white|black)|text-(white|black)|border-(white|black)" tools/dashboard/ui/features/specifications tools/dashboard/ui/features/pull-requests tools/dashboard/ui/features/operations`
3. Zero `color-mix(...)` occurrences remain in those directories.
   `automated: ! grep -rq "color-mix" tools/dashboard/ui/features/specifications tools/dashboard/ui/features/pull-requests tools/dashboard/ui/features/operations`
4. `lane-presentation.ts` contains no `var(--lane-*)` string; `status-board.tsx`
   contains no `'--lane-accent'`. `automated: ! grep -q -- "--lane-accent" tools/dashboard/ui/features/specifications/detail/status-board.tsx`
5. A repo-wide sweep of `tools/dashboard/ui` (excluding `*.stories.tsx`, `tests/`,
   `__fixtures__/`) for `-[var(--`, raw white/black, and `color-mix(` returns zero
   results. `automated: repo-wide grep across tools/dashboard/ui with the story/test/fixture exclusions`
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook` pass.
7. Specifications/PR/operations Storybook stories show no unintended visual change
   (screenshot comparison), except the deliberate `specification-list.tsx` hover fix and
   any lane-color changes verified as parity in `areas/specs-lanes-and-remaining-ui.md`
   acceptance criterion 5.

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
```

## Documentation impact

None yet — `tasks/06-storybook-and-documentation.md`.

## Out of scope

- Removing old `:root` variables, `--color-*: initial`, `theme-color` meta fix, the
  architecture check — `tasks/07-*`, `tasks/08-*`.
