# Owner decisions — storybook-for-nevo-ai

## D1: Storybook framework and test-tooling investment

- **Question:** Which Storybook builder to adopt, and how much automated test tooling to
  add alongside it (spanning from no new render-test dependency up to a full
  Vitest/RTL-based component-testing stack that also retires the repo's existing
  source-regex test workaround)?
- **Options considered:**
  - A — Minimal: no new render-test dependency; verification relies on Storybook build
    success plus manual/agent-driven visual inspection.
  - B — Balanced: add `vitest` + `@vitest/browser` + `@storybook/addon-vitest` (Playwright
    browser provider) so each story gets a real browser-rendered smoke test.
  - C — Target: B, plus `@testing-library/react` + `@testing-library/jest-dom` +
    `@testing-library/user-event`, and migrate the two existing source-regex-assertion
    tests (`turn-work-summary.test.mjs`, `semantic-work-chat-v2-corrections.test.mjs`) to
    real RTL renders.
- **Decision:** Option C. Framework: `@storybook/react-vite` (matches the existing
  Vite+React stack; no other builder is applicable — the repo has no webpack). Test stack:
  Vitest (not a separate Jest install) because Vitest is Jest-API-compatible
  (`describe`/`it`/`expect`, `@testing-library/jest-dom` matchers work unchanged) and is
  what Storybook's own official test integration (`@storybook/addon-vitest`) requires —
  installing literal Jest alongside it would duplicate a responsibility Vitest already
  covers.
- **Rationale:** The dashboard was built quickly ("vibe coded") and is now hard to
  maintain; the owner wants to invest in durable testing/tooling practices now rather than
  defer them, and explicitly confirmed the Vitest/RTL reading of "jest approach" once the
  Jest-vs-Vitest distinction was raised.
- **Consequences:** New devDependencies: `storybook`, `@storybook/react-vite`,
  `@storybook/addon-docs`, `@storybook/addon-vitest`, `vitest`, `@vitest/browser`,
  `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`,
  plus a Playwright browser-binary install for the Vitest browser provider. All are
  dev-only — no production bundle/runtime impact (change-wide constraint, unaffected by
  this decision). Existing `node --test`-based tests for server/tooling code are
  unchanged; a new Vitest suite is added for React component/story rendering only. This
  decision governs `areas/storybook-infrastructure.md` and
  `areas/testing-infrastructure.md` and their tasks.
- **Date:** 2026-09-02
- **Affected artifacts:** `areas/storybook-infrastructure.md`, `areas/testing-infrastructure.md`, `tasks/03-storybook-infrastructure-setup.md`, `tasks/04-component-testing-infrastructure.md`, and every chat/foundation story task's verification section.

## D2: Scope boundary — chat/foundation only, not a dashboard-wide component sweep

- **Question:** Does "introduce more shared and reusable interface elements" mean (a)
  extracting/promoting shared primitives only as needed to support this change's own
  foundation and chat stories, or (b) an open-ended audit and consolidation of shared
  components across the entire dashboard (specs, tasks, changes, PR features, not just
  chat)?
- **Options considered:**
  - Bounded — scope shared-component work to what the chat-surface and foundation stories
    in this change actually require.
  - Dashboard-wide — fold a full cross-feature component-consolidation audit into this
    same change.
- **Decision:** Bounded. The broader dashboard-wide consolidation is explicitly out of
  scope for this change and is deferred to a future, separately-chartered specification.
- **Rationale:** The owner confirmed the dashboard-wide investment is real intent but
  explicitly framed it as context for future work ("I will introduce more in the future by
  myself or different spec"), not this change's mandate. Acceptance criteria for an
  open-ended "audit and consolidate everything" scope cannot be made testable within one
  change; the Storybook/testing pattern established here is meant to be the reusable
  foundation that future spec(s) build on.
- **Consequences:** This change's shared-primitive work is limited to what
  `areas/chat-surface-boundaries.md` and `areas/foundation-stories.md` require. No task in
  this change touches `features/operations/`, `features/pull-requests/`, or
  `features/specifications/`. A follow-up specification is expected, not created here.
- **Date:** 2026-09-02
- **Affected artifacts:** `overview.md` (Out of scope), all area files' own "Out of scope"
  sections.
