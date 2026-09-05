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
    - tools/dashboard/ui/shared/ui/button.tsx
    - tools/dashboard/ui/shared/status-tone.ts
allowed_paths:
  - docs/ai/task-routing.md
  - docs/development/**
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
  - tools/dashboard/ui/**
  - tools/dashboard/tests/**
  - tools/dashboard/components.json
  - tools/dashboard/config/network.mjs
  - tools/dashboard/server/index.mjs
  - tools/tests/docs-routing.test.mjs
consequential_paths:
  - specs/active/semantic-color-tokens-with-tailwind-css-4/**
  - specs/index.generated.json
forbidden_paths:
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
semantic_references:
  decisions: [D1, D2, D3, D10, D13, D14, D15, D16, D17, D18]
  constraints: [C5]
---

# Task: Frontend architecture documentation, story taxonomy alignment, Live-value Colors story, foundation stories migration, and UX/Storybook documentation update

## Goal

Author `docs/development/dashboard-frontend-architecture.md` establishing the complete frontend architecture
contract: routes may delegate directly to single-feature pages while screens serve as the optional multi-feature
composition boundary (D17, D18), features do not import sibling features, canonical UI primitives reside under
`shared/ui/`, generic utilities reside under `shared/lib/`, `components/ui/` is removed, and structural migration
debt is fully resolved. Align all Storybook story titles across primitives, features,
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

- Author `docs/development/dashboard-frontend-architecture.md` establishing layer responsibilities
  (App, Routes, Screens, Features, Shared), component taxonomy, domain areas, public API & import
  boundaries, consolidation of `shared/ui` and removal of `components/ui` (D17, D18), state management,
  Storybook colocation, component placement decision matrix, verified directory layout, and verification commands.
- Story titles in `shared/ui/*.stories.tsx` and `features/**/*.stories.tsx` must align to the
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
- Non-story source files outside approved architecture cleanup and bug fixes are not modified except for
  repairing stale `react-component-guidelines.md` section references in `turn-work-visibility.ts`,
  `turn-work-summary.tsx`, `message-collapse.ts`, and `transcript-message.tsx`. Do not touch canonical
  theme tokens in `index.css`.

## Acceptance criteria

1. `docs/development/dashboard-frontend-architecture.md` is authored reflecting the final architecture
   (optional screen composition layer, direct single-feature route delegation, zero sibling feature imports,
   canonical `shared/ui` primitives and `shared/lib` utilities, removal of `components/ui`), decision matrix,
   verified directory layout, and guidelines, and cross-referenced in related docs.
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
- **Architecture Cleanup and Debt Resolution (D17, D18)**: Per owner approval, the deferred
  migration debt was fully resolved on this branch: domain-independent primitives were consolidated
  into `ui/shared/ui/` and `ui/components/ui/` was deleted, `components.json` was updated to
  `"ui": "@/shared/ui"`, a dedicated screen composition layer was established (`ui/screens/agent-session/`,
  `ui/screens/specification-console/`, `ui/screens/specification-detail/`), routes delegate directly
  to feature pages for single-feature routes (`ActiveSpecificationsPage`, `ArchiveSpecificationsPage`),
  fake `SpecificationSummary` placeholders were removed via screen/content separation, and mechanical
  boundary enforcement was added to `tools/dashboard/tests/architecture-boundaries.test.mjs`.
- **Co-landed Feature Scope**: The dashboard network configuration feature (HTTPS port override
  and HTTP redirect port binding) was restored on this branch per owner approval at commit
  `c4aef0abf814b331797f653848c38fe612e5e2fd`, remaining independent of Task 08's design-system scope.
- **Specification Scope Amendment (`/nevo-ai:task-review`, 2026-09-05)**: `allowed_paths` was widened
  to `tools/dashboard/ui/**`, `tools/dashboard/tests/**`, `tools/dashboard/components.json`,
  `tools/dashboard/config/network.mjs`, and `tools/dashboard/server/index.mjs`, and
  `tools/dashboard/ui/index.css` was removed from `forbidden_paths`, to formally reflect the D16/D17/D18
  owner-approved scope expansion (architecture cleanup, shared/ui consolidation, legacy CSS bridge,
  co-landed network config restore) that was already implemented and documented above but never
  mirrored into this task's declared scope. `specs/active/semantic-color-tokens-with-tailwind-css-4/**`
  and `specs/index.generated.json` were declared `consequential_paths` (mechanical spec-bookkeeping
  writes, not scope violations).

