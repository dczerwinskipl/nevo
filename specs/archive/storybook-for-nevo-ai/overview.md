---
id: spec.storybook-for-nevo-ai
type: change
title: "Storybook for Nevo AI"
status: draft
change: storybook-for-nevo-ai
---

# Storybook for Nevo AI

## Context

`tools/dashboard/ui/` has no isolated UI-development, documentation, or visual-verification
environment today. Every component can only be seen running inside the full dashboard app,
against a live (or mocked-at-the-network-layer) backend. The dashboard was built quickly and
is now hard to maintain; the owner wants to invest now in the tooling that makes UI work
verifiable and its patterns reusable, rather than continuing to add UI without a workbench
or a component-testing story. The target chat/Work surface (`work-v2/`) is the first
substantial use case, chosen because it is both the most complex UI surface in the dashboard
and — per discovery below — already largely decoupled from live infrastructure.

## Current architecture

Facts, gathered by direct repository inspection and a read-only research pass (see
`owner-decisions.md` for the decisions built on top of these facts):

- Single manifest `tools/dashboard/package.json` covers server + UI. React 19, Vite 8
  (`tools/dashboard/vite.config.ts`) with `@tailwindcss/vite`, `@vitejs/plugin-react`,
  `@tanstack/router-plugin`; path alias `@` → `tools/dashboard/ui/` (`vite.config.ts:25-27`,
  mirrored in `tools/dashboard/tsconfig.app.json`'s `paths`).
- Test runner is Node's built-in `node --test` (`--experimental-strip-types`) — no Vitest,
  no Jest, no `@testing-library/*`, no jsdom exist anywhere in `tools/dashboard/package.json`
  today. TypeScript is stripped but JSX is not transformed, so no `.tsx` file can currently
  be rendered by any test in this repo.
- No Storybook packages, no `*.stories.*` files, and no isolated-component-rendering
  precedent exist anywhere in the repository.
- Tailwind v4 is configured CSS-first (no `tailwind.config.*`) via
  `@import "tailwindcss"` at the top of `tools/dashboard/ui/index.css`, loaded once from
  `tools/dashboard/ui/main.tsx:6`. Theme/semantic tokens are CSS custom properties in that
  same file: neutral surfaces (`--background`/`--surface`/`--surface-raised`/`--border`/etc.,
  `index.css:6-14`), accent tokens (`index.css:17-21`), and semantic state tokens
  `--success`/`--warning`/`--danger`/`--info` with base/strong/muted/border variants
  (`index.css:24-39`). `color-scheme: dark` is set unconditionally on `:root`
  (`index.css:4`) — one dark theme only, no toggle, no theme provider/context anywhere in
  the codebase.
- Font is declared as `Inter, ui-sans-serif, system-ui, ...` by name only
  (`index.css:52`) — there is no `@font-face` rule, no bundled font file, and no
  Google-Fonts-style link in `tools/dashboard/ui/index.html`. This is a pre-existing gap,
  not something this change silently fixes; foundation stories must document the font stack
  as it actually renders today (falling back to system fonts wherever "Inter" isn't
  installed), not assume a font-loading mechanism that doesn't exist.
- `main.tsx` wraps `<App />` in `<StrictMode>` and `<QueryClientProvider>` only
  (`main.tsx:17-23`); `App.tsx` renders only `<RouterProvider router={router} />` — no
  theme provider, no toast provider, no other global context at the app root.
- Chat/Work component coupling (the area the brief's required discovery targets):
  `AgentSessionComposer` (`features/agent-sessions/composer/agent-session-composer.tsx`),
  `AgentSessionTranscriptV2`
  (`features/agent-sessions/work-v2/agent-session-transcript-v2.tsx`), and the entire
  `work-v2/` tree (`TurnWorkPanelV2`, `WorkTimelineV2`, `WorkIndicatorV2`,
  `WorkDetailsSheetV2`) are already purely props/callback-driven — none of them call
  `useQuery`/`useMutation`, open an SSE connection, read router state, or read from context.
  `timeline-projection-v2.ts` is already a pure, React-free typed projection
  (`buildTimelineRowsV2`, `projectTimelineV2`) over the canonical `CanonicalTurnV2`/
  `WorkItemV2` types (`features/agent-sessions/types.ts`). The one timer in this cluster,
  `useElapsedLabel` (`work-v2/use-elapsed-label.ts:17-30`), is driven only by a `startedAt`
  prop, not a live subscription.
- Only `AgentSessionPage` (`features/agent-sessions/agent-session-page.tsx`) and
  `AgentSessionRoute` (`features/agent-sessions/agent-session-route.tsx`) are actually
  coupled to live infrastructure: `AgentSessionPage` calls `useAgentSessionRuntime` (which
  opens the SSE connection via `agent-event-source.ts`), `useAgentProviders()`,
  `useDeleteAgentSession()`, and `useInitialDispatch(...)` directly; `AgentSessionRoute`
  reads TanStack Router params and calls `useSpecificationIndex()`/`useAgentSessions(...)`.
  Neither exposes today a single composition point that assembles composer + transcript +
  Work into the full chat layout independently of that live wiring — the composition
  currently lives inside `AgentSessionPage`'s own JSX, alongside the live hooks.
- `docs/development/react-component-guidelines.md:374` already states visual components
  should be tested with React Testing Library, but no RTL/jsdom tooling exists in the repo
  to do so today — an existing, documented-but-unmet expectation this change's testing
  infrastructure directly closes.
- `tools/dashboard/ui/components/ui/` (`badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`,
  `progress.tsx`, `sheet.tsx`, `status-card.tsx`) already contains the application-owned
  Radix wrapper layer described in `docs/development/react-component-guidelines.md` §4.2.

## Problem

There is no way to develop, document, or visually verify dashboard UI in isolation. Every
change to the chat/Work surface — the most complex and most frequently touched UI in the
dashboard — can only be checked by running the whole app against a live or network-mocked
backend, which makes hard-to-reach states (waiting for first activity, active tool, active
thinking) slow and awkward to reach deliberately, and gives agents no deterministic way to
inspect a rendered state before claiming a visual change is correct. There is also no
component-level test tooling at all: the two existing tests that touch `work-v2/`
(`turn-work-summary.test.mjs`, `semantic-work-chat-v2-corrections.test.mjs`) fall back to
asserting on raw source text with regex because nothing in the repo can render a `.tsx` file
and inspect its output.

## Constraints

- **C1.** Storybook and its test tooling are dev-only dependencies; they must not affect the
  production bundle or runtime (`vite build`'s output must be unaffected).
- **C2.** Storybook must reuse the exact production Tailwind config, global CSS, and token
  sources — no parallel Storybook-only styles or a duplicated/aspirational token set.
- **C3.** No new external dependency is used without the explicit approval recorded in
  `owner-decisions.md` (D1) — this applies to every package this change adds, not only
  Storybook itself.
- **C4.** `docs/development/react-component-guidelines.md`,
  `docs/development/ui-ux-guidelines.md`, `docs/development/nevo-ai-ux-guidelines.md`, and
  `docs/development/nevo-interaction-model.md` govern any component boundary or
  presentation change made in this change — component splits/extractions follow those
  documents' criteria, not line-count or cosmetic reorganization.
- **C5.** Configurable story data uses the canonical UI-facing model (`CanonicalTurnV2`/
  `WorkItemV2` from `features/agent-sessions/types.ts`), never raw provider protocol
  payloads.
- **C6.** Per D2, shared-component/design-system work in this change is bounded to what the
  foundation and chat stories need — no dashboard-wide component sweep.
- **C7.** No literal Jest test runner is introduced — Vitest is the one JS test runner this
  change adds (D1).

## Affected modules

- `tools/dashboard/ui/` (new `.storybook/` config, new `*.stories.tsx` files, possible
  extraction inside `features/agent-sessions/`)
- `tools/dashboard/package.json` / lockfile (new devDependencies, new scripts)
- `tools/dashboard/tests/turn-work-summary.test.mjs`,
  `tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs` (migrated to RTL)
- `docs/development/` (new Storybook usage doc, or an addition to an existing development
  doc — decided in the documentation task)

## Options and trade-offs

See `owner-decisions.md` D1 for the full three-option comparison (minimal / balanced /
target) that was presented and decided, and D2 for the bounded-vs-dashboard-wide scope
comparison. Both are recorded there rather than repeated here.

## Owner decisions

See `owner-decisions.md`: D1 (Storybook framework + test-tooling investment — decided:
target/Option C, Vitest-based) and D2 (scope boundary — decided: bounded to chat/foundation,
dashboard-wide consolidation deferred to a future spec).

## Proposed architecture

Six areas, ordered so the chat surface is proven renderable from deterministic state before
a large set of chat stories is built on top of it, while Storybook infrastructure and
foundation stories proceed in parallel where nothing blocks them:

1. **`chat-surface-boundaries`** — formalize (task 01) and, if needed, implement (task 02)
   a single composition point for composer + transcript + Work that both `AgentSessionPage`
   and Storybook can use, given the discovery above already shows most of the tree is
   presentational.
2. **`storybook-infrastructure`** — install and configure `storybook` +
   `@storybook/react-vite`, reusing the production Vite/Tailwind/CSS pipeline exactly, with
   no production-bundle impact. Independent of area 1.
3. **`testing-infrastructure`** — wire `vitest` + `@vitest/browser` +
   `@storybook/addon-vitest` + RTL, and migrate the two existing regex-based tests to real
   renders. Depends on area 2's Storybook config existing.
4. **`foundation-stories`** — typography and color stories rendering the real production
   tokens. Depends on area 2.
5. **`chat-stories`** — a typed, reusable fixture/scenario builder over
   `CanonicalTurnV2`/`WorkItemV2`, then the five required deterministic chat states. Depends
   on areas 1 and 3.
6. **`documentation`** — how to start/build Storybook, the story hierarchy, fixture reuse,
   when to use Args vs. providers/decorators vs. network mocking, and how an agent verifies
   a story before declaring UI work complete. Depends on areas 2–5 having real patterns to
   document.

## Areas

- `areas/chat-surface-boundaries.md` — chat/Work component coupling audit and, if required,
  the composition-point extraction.
- `areas/storybook-infrastructure.md` — Storybook install/config reusing production styling.
- `areas/testing-infrastructure.md` — Vitest/RTL/`addon-vitest` wiring and the two-test
  migration.
- `areas/foundation-stories.md` — typography and color foundation stories.
- `areas/chat-stories.md` — fixture/scenario model and the five required chat states.
- `areas/documentation.md` — Storybook usage documentation.

## Change-wide acceptance criteria

1. `npm run storybook` (or equivalent script defined by area 2) starts Storybook
   successfully with no live backend or AI provider running.
2. `npm run build-storybook` (or equivalent) builds the static Storybook successfully.
3. `vite build`'s production output is unaffected by any change in this spec (no Storybook
   code/dependency reachable from the production entry point).
4. Every initial story (foundations + the five chat states) renders without a live backend
   or AI provider.
5. Storybook loads the same fonts, Tailwind utilities, and theme tokens as the production
   dashboard — verified by rendering, not by source/class-name inspection alone. The
   dashboard has no light/dark toggle, theme class, data attribute, or theme
   provider/context (fact — `index.css:63-77` styles `html`/`body` unconditionally); every
   story renders by default on the real production background/foreground computed from
   that same CSS, not merely inside a dark Storybook Canvas chrome — no white Canvas, white
   Docs-page background, or white initial/flash-of-unstyled paint is visible anywhere, at
   any point.
6. `node tools/specs.mjs validate` and `node tools/docs.mjs validate` (if docs changed)
   pass.

## Verification strategy

- Automated: the Vitest suite added in `testing-infrastructure` (via
  `@storybook/addon-vitest`, which renders each story in a real browser) is the primary
  automated verification for story correctness. Existing `node --test` suites remain
  authoritative for server/tooling code and are unaffected.
- Manual/agent visual verification: use the `mcp__playwright__*` tools already available in
  this environment to load the running/built Storybook and inspect rendered stories and
  computed styles — no new npm Playwright dependency is needed for this purpose (the
  `@vitest/browser` Playwright provider added under D1 is a separate, test-execution-time
  dependency). An agent must not claim visual consistency from source code or class names
  alone; see `areas/documentation.md` for the exact agent verification workflow this change
  documents.
- Desktop and mobile viewports are checked for every chat story (per the brief's required
  story list) using Storybook's viewport controls plus, where exact values matter, MCP
  Playwright's `browser_take_screenshot`/computed-style inspection.

## Out of scope

- Migrating any dashboard component outside `features/agent-sessions/` (chat/Work) and the
  minimal shared primitives areas 1/4 genuinely require.
- A dashboard-wide shared-component consolidation audit (D2) — deferred to a future spec.
- Running a real AI agent or reproducing full provider protocols inside Storybook.
- Full SSE/reconnect integration testing (remains the responsibility of the existing
  integration test suite).
- A broad chat redesign beyond what's needed to make it deterministically renderable.
- A complete design-system rewrite — foundation stories document existing production
  tokens, they do not introduce a new aspirational palette.
- A custom Storybook addon — standard Args/Controls are used throughout.
- Mandatory cloud visual-regression infrastructure.
- Migrating the literal Jest test runner in anywhere — Vitest is the one JS test runner
  added by this change (D1).
