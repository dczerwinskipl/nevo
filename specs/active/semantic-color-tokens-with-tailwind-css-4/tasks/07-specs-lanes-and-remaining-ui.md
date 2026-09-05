---
id: semantic-color-tokens-with-tailwind-css-4.specs-lanes-and-remaining-ui
status: draft
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
  decisions: [D2, D3, D4, D8, D9]
  constraints: [C5, C7, C8]
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
  `tasks/04-*` (stop using `accent-strong`/`accent-solid` as hover text color).
- Resolve the error-banner, warning-banner, selected-pill, and muted-warning-text
  `color-mix` recipe families the same way `tasks/06-*` resolved them in
  `create-agent-session-dialog.tsx`/`interaction-prompt.tsx`/`provider-unavailable-banner.tsx`
  — consistent opacity-modifier naming across both tasks.
- After the named directories are migrated, grep the rest of
  `tools/dashboard/ui/**/*.{ts,tsx}` (excluding `*.stories.tsx`, `tests/`,
  `__fixtures__/`) for `-[var(--`, raw white/black, and `color-mix(` and fix any
  remaining occurrence — this is the last TS/TSX consumer-migration task before
  `tasks/09-*` removes the old CSS variables. **This sweep excludes `index.css` and
  every other `.css` file entirely** — `index.css` is forbidden to this task (see
  `forbidden_paths`) and still legitimately contains `color-mix(...)` at this point (the
  old `:root` token definitions, plus the two selector-oriented exceptions in
  `::selection`/`.markdown-body blockquote` the class-composition contract already
  allows for global CSS). Migrating or preserving those is `tasks/09-*`'s job, not this
  task's — do not attempt it and do not let this task's sweep report them as a failure.
- `pull-requests/changes/status.ts:10-15`'s `stateTone()`: keep its own PR-state→tone
  mapping feature-local (per D8 — PR state is a different canonical domain than
  Turn/tool status), but change it to consume the shared `StatusTone` type and the
  `shared/status-tone.ts` tone-rendering recipe from `tasks/05-*` instead of returning
  independently-invented full class strings.
- `specification-metadata-fields.tsx:92-96` and
  `specification-ai-planning-section.tsx:83-89,120-124`: convert the ternary
  expressions that select whole pre-written class strings into `cn()`-based conditional
  composition, per the class-composition contract (D8).
- Apply the "required inspection when touching a component" checklist
  (`react-component-guidelines.md` §11/§12) to every component this task changes.
- **Destructive-action audit (item 5):** confirmed by grep — no delete/remove/destructive
  button pattern exists under `features/specifications/**` or `features/pull-requests/**`
  (the only real destructive action in this change is agent-sessions' delete-session
  button, migrated in `tasks/06-*`). No action needed here; do not introduce a
  destructive-variant usage without a genuine consumer.
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
5. A sweep of `tools/dashboard/ui/**/*.{ts,tsx}` (excluding `*.stories.tsx`, `tests/`,
   `__fixtures__/`, and — not applicable to this extension anyway — `index.css`) for
   `-[var(--`, raw white/black, and `color-mix(` returns zero results.
   `automated: repo-wide grep across tools/dashboard/ui/**/*.{ts,tsx} with the story/test/fixture exclusions`
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook` pass.
7. Durable Storybook tests for Specifications/PR/operations components pass, covering
   the deliberate `specification-list.tsx` hover fix and each of the 6 lane states — the
   lane-color changes are verified for parity against
   `areas/specs-lanes-and-remaining-ui.md` acceptance criterion 5's per-lane check, not
   claimed pixel-identical as a blanket statement (D9).
8. `pull-requests/changes/status.ts` consumes the shared `StatusTone` type/recipe; its
   own PR-state→tone mapping stays feature-local. `inspection: source reviewed`
9. The two named ternary-based class selections use `cn()`. `inspection: source reviewed`
10. The "required inspection when touching a component" checklist was applied.
    `inspection: checklist applied and recorded per component`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
```

## Documentation impact

None yet — `tasks/08-storybook-and-documentation.md`.

## Out of scope

- Removing old `:root` variables, `--color-*: initial`, `theme-color` meta fix, the
  architecture check — `tasks/09-*`, `tasks/10-*`.
