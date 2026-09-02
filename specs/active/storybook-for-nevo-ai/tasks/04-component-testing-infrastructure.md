---
id: storybook-for-nevo-ai.component-testing-infrastructure
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/owner-decisions.md
    - specs/active/storybook-for-nevo-ai/areas/testing-infrastructure.md
    - tools/dashboard/package.json
    - tools/dashboard/tests/turn-work-summary.test.mjs
    - tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs
  optional:
    - docs/development/react-component-guidelines.md
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/vitest.config.ts
  - tools/dashboard/.storybook/**
  - tools/dashboard/tests/turn-work-summary.test.mjs
  - tools/dashboard/tests/turn-work-summary.test.tsx
  - tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs
  - tools/dashboard/tests/semantic-work-chat-v2-corrections.test.tsx
forbidden_paths:
  - tools/dashboard/ui/features/**
  - tools/dashboard/server/**
  - src/**
  - tests/NEvo.*/**
depends_on:
  - storybook-infrastructure-setup
semantic_references:
  decisions: [D1]
  constraints: [C1, C3, C7]
  dependency_contracts: [storybook-infrastructure-setup]
---

# Task: Wire Vitest/RTL component testing and migrate the two source-regex tests

## Goal

Add `vitest`, `@vitest/browser`, `@storybook/addon-vitest`, `@testing-library/react`,
`@testing-library/jest-dom`, `@testing-library/user-event`, and a Playwright browser binary
as devDependencies; configure `@storybook/addon-vitest` against the Storybook config from
task 03; and migrate `turn-work-summary.test.mjs` and
`semantic-work-chat-v2-corrections.test.mjs` off their documented source-regex-assertion
workaround onto real RTL renders.

## Dependencies

- `storybook-infrastructure-setup` (task 03) — needs `.storybook/main.ts` to exist.

## Implementation constraints

- Do not install or configure the literal Jest test runner (D1) — Vitest's Jest-compatible
  API is the one JS test runner this change adds.
- Only migrate the specific assertions in the two named test files that assert on raw source
  text via regex (cited in those files' own comments); assertions already exercising pure
  projection functions directly are unaffected.
- Do not move any existing `node --test` server/tooling test into Vitest.
- New/renamed test files may use a `.test.tsx` extension where JSX is needed for RTL
  rendering — keep the migrated test's file name recognizable as the successor to its
  `.test.mjs` original (e.g. same base name).

## Acceptance criteria

1. `npx vitest run` (via the npm script this task defines) executes and passes, including a
   real RTL-rendered assertion in each migrated test's successor.
   `automated: npm --prefix tools/dashboard run test:storybook`
2. Every story that exists at the time this task runs (likely none yet) renders successfully
   under `@storybook/addon-vitest`. `inspection: vacuously true if no stories exist yet; re-verify once tasks 05/07/08/09 land`
3. `node --test tools/dashboard/tests/*.test.mjs` continues to pass for every file not
   migrated by this task. `automated: node --test tools/dashboard/tests/*.test.mjs`
4. No dependency added by this task is reachable from `tools/dashboard/ui/main.tsx`.
   `inspection: grep main.tsx and its import graph for the new packages`

## Verification

```text
npm --prefix tools/dashboard run test:storybook
node --test tools/dashboard/tests/*.test.mjs
```

## Out of scope

- Testing any story beyond what exists when this task runs.
- Migrating any other existing `node --test` file.
