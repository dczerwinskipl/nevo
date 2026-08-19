---
id: ux-improvements-version-1.design-tokens
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/colors.md
    - .nevo-ai-local/ux-review/report/01-colors.md
    - tools/dashboard/src/index.css
  optional: []
allowed_paths:
  - tools/dashboard/src/index.css
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/operation-progress.tsx
  - tools/dashboard/src/components/status-card.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/status-board.tsx
  - tools/dashboard/src/components/changes-panel.tsx
  - tools/dashboard/src/components/stage-progress.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Shared color design tokens (COLOR-1)

## Goal

Add semantic (`--secondary`, `--success`, `--warning`, `--danger`, `--info`, each with a
`-strong` variant) and categorical (`--cat-1`, `--cat-2`, `--cat-3`) CSS custom properties to
`tools/dashboard/src/index.css`, following the `color-mix()` derivation pattern already used at
`status-board.tsx:21`, then migrate every hardcoded usage listed in
`.nevo-ai-local/ux-review/report/01-colors.md`'s migration table to the matching token.

## Implementation constraints

- Add tokens exactly as proposed in COLOR-1's "Ready-to-paste block for `index.css`" (hex
  values formalize colors already in use in the app, not new colors — no separate owner
  decision needed on the values themselves).
- Do not modify `--accent`, `--accent-strong`, or any existing neutral token
  (`--background`, `--surface`, `--surface-raised`, `--surface-hover`, `--border`,
  `--border-strong`, `--foreground`, `--muted`, `--muted-strong`).
- Every `-bg`/`-border` variant is derived via `color-mix(in srgb, var(--role) N%, ...)` —
  do not introduce a second derivation mechanism.
- Migrate, file:line exact per the report:
  - `text-rose-*`/`bg-rose-*` (`operation-progress.tsx` 6 spots, `status-card.tsx:90,98,101`) → `--danger`.
  - `text-amber-*` on `isRunning` (`ai-tool-view.tsx:40,50`) → `--info`.
  - `text-sky-*` on `running` (`operation-progress.tsx:24,38,52`) → `--info`.
  - `bg-amber-500/10 text-amber-300` Claude badge (`ai-session-list.tsx:54`) → `--cat-1`.
  - `bg-emerald-500/10 text-emerald-300` mock/fallback badge (`ai-session-list.tsx:67`) →
    `--muted-strong` on `--surface`.
  - `stageTone` 5 hues (`status-board.tsx:15-22`): New/Design/Ready → `--muted` (no fill);
    Implementation → `--info`; Review → `--warning`; Done → unchanged `--accent`.
  - Remaining `text-slate-*`/`text-zinc-*` neutral text (`operation-progress.tsx`,
    `changes-panel.tsx:64`, `stage-progress.tsx:10`) → `--muted`/`--muted-strong`.
- Semantic tokens are never applied to pure decoration/identity uses; categorical tokens never
  signal status/severity.

## Acceptance criteria

1. `index.css` defines all 11 new tokens (5 roles × text/strong, + 3 categorical), each with
   `-bg`/`-border` derivable via `color-mix()`. `inspection: read index.css, confirm the token block matches COLOR-1's proposed block`
2. No file:line listed above still contains its pre-migration Tailwind class or raw hex.
   `inspection: grep each listed file for the old class name, expect zero matches`
3. `npm --prefix tools/dashboard run build` passes (catches any broken className/type
   reference). `automated: npm --prefix tools/dashboard run build`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- The task-board column *structure* (nesting, bulk-approve placement) —
  `flatten-review-card-nesting` (task 14) owns that; this task only changes which color each
  column state uses.
- NAV-5's lifecycle stepper (deferred) — not built here.
