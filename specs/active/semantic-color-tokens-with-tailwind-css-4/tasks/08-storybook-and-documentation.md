---
id: semantic-color-tokens-with-tailwind-css-4.storybook-and-documentation
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/storybook-and-documentation.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/storybook.md
    - docs/development/dashboard-frontend-architecture.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/foundations/colors.stories.tsx
  optional:
    - docs/development/react-component-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - tools/dashboard/ui/components/ui/button.tsx
    - tools/dashboard/ui/shared/status-tone.ts
allowed_paths:
  - docs/ai/task-routing.md
  - docs/development/**
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
  - tools/dashboard/ui/foundations/**
  - tools/dashboard/ui/components/ui/*.stories.tsx
  - tools/dashboard/ui/features/**/*.stories.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx
  - tools/dashboard/ui/features/agent-sessions/transcript/**
  - tools/dashboard/ui/features/agent-sessions/turn-work/**
  - tools/dashboard/ui/shared/ui/*.stories.tsx
  - tools/dashboard/.storybook/**
  - tools/tests/docs-routing.test.mjs
forbidden_paths:
  - tools/dashboard/ui/index.css
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
semantic_references:
  decisions: [D1, D2, D3, D10, D13, D14, D15, D16, D17]
  constraints: [C5]
---

# Task: Frontend architecture documentation, story taxonomy alignment, Live-value Colors story, foundation stories migration, and UX/Storybook documentation update

## Goal

Author `docs/development/dashboard-frontend-architecture.md` establishing the complete frontend architecture
contract (`app -> routes -> features -> shared`), component taxonomy, domain areas, public API boundaries,
and deferred `components/ui` migration (D15). Align all Storybook story titles across primitives, features,
and foundations with this taxonomy. Rewrite `colors.stories.tsx` to read live computed `--color-*` values grouped by
semantic role (no duplicated TypeScript palette), including the canonical status set,
provider/workflow tokens, and the filled-button contrast pair. Migrate all foundation
stories (`colors.stories.tsx`, `typography.stories.tsx`, `smoke.stories.tsx`) to semantic
Tailwind utilities and live token resolution. Update `docs/development/storybook.md` to
reflect actual story hierarchy and co-location rules, repair stale section references to
`react-component-guidelines.md`, and update UX color-role documentation.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`.

## Implementation constraints

- Author `docs/development/dashboard-frontend-architecture.md` with all 11 required sections:
  Executive Summary, Layer Responsibilities, Component Taxonomy, Domain Areas, Public API & Import
  Boundaries, Resolution of `components/ui` vs `shared/ui`, State Management, Storybook Colocation,
  Component Placement Decision Matrix, Directory Structure, and Migration Strategy.
- Story titles in `components/ui/*.stories.tsx` and `features/**/*.stories.tsx` must align to the
  component taxonomy (`Shared/UI/*`, `Features/<Domain>/*`, `Foundations/*`).
- No hardcoded hex value may appear in `colors.stories.tsx` for any token also defined
  in `index.css` — read via computed styles.
- Add a Storybook test (via the existing `test:storybook`/Vitest-browser infrastructure)
  asserting that every token catalogued in the story resolves to a non-empty computed
  color value — including the two `@theme static inline` alias tokens (`status-active`,
  `status-neutral`), not just the direct-value tokens.
- Migrate all foundation stories:
  - `colors.stories.tsx`: live token resolution, remove copied hex/RGB expectations, remove
    stale source-line metadata.
  - `typography.stories.tsx`: replace legacy `var(--foreground)`-style utilities and raw
    colors with semantic utilities (`text-fg-primary`, `text-fg-secondary`, `text-fg-muted`).
  - `smoke.stories.tsx`: replace raw `amber-*` palette utilities with semantic tokens.
- Documentation consistency:
  - Update `docs/development/storybook.md` to describe the actual story hierarchy and
    co-location rules (remove outdated claim that `Components/*` is unused).
  - Find references in source code to moved/nonexistent numeric sections of
    `react-component-guidelines.md` (`§20.1`, `§16`, old `§9.1`/`§9.2`) and remove or replace
    them with stable doc IDs and heading names.
- After changing any `docs/development/**` content, run `node tools/docs.mjs generate`
  to refresh `docs/index.generated.json`/`docs/index.generated.md`/`docs/routing.generated.json`,
  then `node tools/docs.mjs validate` and `node tools/docs.mjs check`.
- Non-story source files in `components/ui/**` and `features/**` are not modified except for
  repairing stale `react-component-guidelines.md` section references in `turn-work-visibility.ts`,
  `turn-work-summary.tsx`, `message-collapse.ts`, and `transcript-message.tsx`. Do not touch `index.css`.

## Acceptance criteria

1. `docs/development/dashboard-frontend-architecture.md` is authored with all 11 required
   sections, decision matrix, pseudo-tree, and guidelines, and cross-referenced in related docs.
2. Story titles match the component taxonomy (`Shared/UI/*`, `Features/*`, `Foundations/*`).
3. `colors.stories.tsx` contains zero duplicated hex literals for theme-defined tokens.
4. Tokens are grouped by the same categories as the `@theme` block (neutral, foreground,
   interaction, status, action, provider, workflow).
5. The filled-button pair (`bg-accent-solid text-fg-on-accent`) is shown with a
   verifiable ≥4.5:1 contrast ratio.
6. `cat-1`/`cat-2`/`info-strong`/`info-muted`/`info-border`/`success-strong` no longer
   appear in the story.
7. All 7 `StatusTone` values are represented, plus `action-destructive` shown separately.
8. All foundation stories (`colors`, `typography`, `smoke`) use semantic Tailwind utilities
   and live token resolution with no legacy `var(--foreground)`, raw `amber-*`, or stale line numbers.
9. `docs/development/storybook.md` accurately describes story hierarchy and co-location rules.
10. Fragile numeric section references to `react-component-guidelines.md` are replaced or removed.
11. `npm --prefix tools/dashboard run test:storybook` and `npm --prefix tools/dashboard run build-storybook` pass.
12. `node tools/docs.mjs generate` was run, and `node tools/docs.mjs validate` and `node tools/docs.mjs check` both pass.

## Verification

```text
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
node tools/docs.mjs generate
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

Updates `docs/development/storybook.md`, `docs/development/ui-ux-guidelines.md`, and references across docs.

## Out of scope

- Feature-level component migration.

## Implementation Provenance and Scope Corrections

- **Owner Approval**: Authorized scope expansion, frontend architecture corrections, and
  foundation stories migration for Task 08.
- **Initial Implementation**: Partial architecture definition and story colocation landed at
  commit `90914f4756543b59dfa3e9c5ec37ce4ea6cfad1f`.
- **Scope Corrections and Foundation Migration**: Final architectural stack corrections
  (React 19.2.8, Vite 8.2.1, TypeScript 7.0.2, Tailwind 4.3.3, Vitest 4.1.11, Storybook 10.6.0,
  Playwright headless browser testing reality without automated axe-core), docs discovery routing
  (RT-31), Storybook primitive `meta.component` ownership, real `AgentSessionDetails` story rendering
  (with `data-testid="delete-session-btn"` in `agent-session-details.tsx`), and complete foundation
  stories migration (`colors.stories.tsx`, `typography.stories.tsx`, `smoke.stories.tsx`) landed at
  commit `79133077fa78a1989b496ec515389d474192d8d6`.
- **Deferred Migration Debt**: Mass migration of `components/ui` to `shared/ui`, updating shadcn
  `components.json` alias configuration, and cross-feature deep-import refactoring are formally
  deferred to dedicated future changes.
- **Co-landed Feature Scope**: The dashboard network configuration feature (HTTPS port override
  and HTTP redirect port binding) was restored on this branch per owner approval at commit
  `c4aef0abf814b331797f653848c38fe612e5e2fd`, remaining independent of Task 08's design-system scope.

