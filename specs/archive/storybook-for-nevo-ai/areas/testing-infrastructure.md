# Area: testing-infrastructure

## Responsibility

Give the dashboard a real component-rendering test capability (per owner decision D1),
wired both standalone and through Storybook, and retire the existing source-regex test
workaround in favor of real RTL renders.

## Current state

`tools/dashboard/package.json`'s only test runner is Node's built-in `node --test`
(`--experimental-strip-types`), which strips TypeScript but does not transform JSX — no
`.tsx` file can be rendered by any existing test. `docs/development/react-component-guidelines.md:374` already documents an RTL-based testing expectation that
has never been met in this repo. Two existing tests work around this today by asserting on
raw source text with regex, with comments in the tests themselves stating this is a
JSX-rendering-capability workaround: `tools/dashboard/tests/turn-work-summary.test.mjs:135-140,172-177` and `tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs`.

## Requirements

- Add devDependencies (per D1): `vitest`, `@vitest/browser`, `@storybook/addon-vitest`,
  `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and
  a Playwright browser binary for the `@vitest/browser` provider.
- Configure `@storybook/addon-vitest` against the `.storybook/main.ts` from
  `areas/storybook-infrastructure.md`, so every story in the project is runnable as a Vitest
  browser-mode test (Storybook's own "component testing" integration — each story becomes
  an implicit smoke test; explicit `play`/assertion functions may be added per story where
  useful, not mandated for every story).
- Add a `vitest.config.ts` (or a Storybook-generated equivalent) and a new npm script (e.g.
  `test:storybook` or `test:ui`) that runs the Vitest project. This is additive — the
  existing `npm test` (`node --test tests/*.test.mjs`) script and its scope are unchanged.
- Migrate `turn-work-summary.test.mjs` and `semantic-work-chat-v2-corrections.test.mjs`
  (or their successors) off the source-regex assertions specifically called out in their own
  comments, replacing them with real RTL renders using `@testing-library/react` +
  `@testing-library/jest-dom`, run under the new Vitest project. Assertions that already
  exercise pure projection functions directly (not source-regex) are unaffected — only the
  regex-on-source-text assertions are migrated.

## Constraints

- Dev-only: none of these dependencies are imported from any file reachable from
  `tools/dashboard/ui/main.tsx` — production bundle is unaffected.
- Do not introduce the literal Jest test runner (D1) — Vitest's Jest-compatible API/matchers
  are the one JS test runner this change adds.
- Do not change the existing `node --test` suite's scope or move server/tooling tests into
  Vitest — that split (Node test runner for server/tooling `.mjs`, Vitest for React
  `.tsx`) is deliberate, not a gap to close.

## Interfaces and boundaries

- Consumed by `areas/chat-stories.md` and `areas/foundation-stories.md`: both are expected
  to gain story-level tests via the `@storybook/addon-vitest` wiring this area establishes,
  and both areas' tasks list this as part of their own acceptance criteria rather than this
  area re-testing their content.
- Consumes: `.storybook/main.ts` from `areas/storybook-infrastructure.md`.

## Area-specific acceptance criteria

1. `npx vitest run` (or the exact script name this task defines) executes and passes,
   including at least one real RTL-rendered assertion for each of the two migrated test
   files.
2. Every story that exists at the time this task completes (there may be none yet, if this
   area's task runs before areas 4/5 — in that case this criterion is satisfied vacuously
   and re-verified once stories exist) renders successfully under
   `@storybook/addon-vitest`.
3. `node --test tools/dashboard/tests/*.test.mjs` (the existing suite, minus the two files
   migrated) continues to pass unchanged.
4. No new dependency added by this area is reachable from `tools/dashboard/ui/main.tsx` or
   affects `vite build`'s production output.

## Dependencies

- `storybook-infrastructure` (needs `.storybook/main.ts` to exist).

## Out of scope

- Testing any story content beyond what already exists when this task runs — new stories
  added later (areas 4/5) are responsible for their own story-level test coverage using the
  infrastructure this area provides.
- Migrating any other existing `node --test` file beyond the two named above.
