# Area: storybook-infrastructure

## Responsibility

Install and configure Storybook so it builds and runs against `tools/dashboard/ui/`,
reusing the production Vite/Tailwind/CSS/font pipeline exactly, with zero production-bundle
impact.

## Current state

No Storybook package, config, or story file exists anywhere in the repository (confirmed by
package.json/lockfile grep and a repo-wide glob for `*.stories.*`). The frontend already
runs on Vite 8 with `@tailwindcss/vite` and `@vitejs/plugin-react` (`tools/dashboard/vite.config.ts:1-3`), which is what makes `@storybook/react-vite` a direct fit — no
webpack, no second build pipeline to reconcile.

## Requirements

- Add `storybook`, `@storybook/react-vite`, and `@storybook/addon-docs` as devDependencies
  in `tools/dashboard/package.json` (per D1).
- Create `.storybook/main.ts` and `.storybook/preview.ts(x)` under `tools/dashboard/`,
  configured with `framework: '@storybook/react-vite'`.
- `.storybook/main.ts`'s Vite config must reuse the *same* Tailwind plugin, path alias
  (`@` → `ui/`), and PostCSS/Tailwind pipeline as `tools/dashboard/vite.config.ts` — either
  by importing/merging the real `vite.config.ts` or by extracting the shared pieces (Tailwind
  plugin, alias) into something both configs import. Do not hand-write a second, parallel
  Tailwind/alias configuration that can drift from production.
- `.storybook/preview.ts(x)` imports the real `tools/dashboard/ui/index.css` (the same file
  `main.tsx` imports) so global tokens, semantic colors, and the font stack are identical to
  production — not a copy.
- The preview must render every story on the real production background/foreground by
  default, not merely inside a dark Storybook Canvas chrome. The dashboard has no
  light/dark toggle, theme class, data attribute, or theme provider/context (confirmed
  fact — `overview.md` § "Current architecture"; `index.css:63-77` styles `html`/`body`
  unconditionally with `background: var(--background)` and `color: var(--foreground)`, no
  conditional selector). Concretely:
  - Ensure the imported `index.css` rules actually apply to the Storybook preview iframe's
    own `html`/`body` (not only to a wrapper `<div>` the story is rendered into) — verify
    Storybook's own baseline/reset styles don't load after and override them.
  - Disable or align Storybook's `backgrounds` addon default so it does not paint its own
    default (typically white) background over/before the real one — the real background
    comes from `index.css`, the addon must not fight it.
  - No white Canvas, white docs-page chrome, or white initial paint may remain visible
    around or before a story renders, in either the story canvas or the Storybook Docs
    page.
- Add npm scripts: `storybook` (dev server) and `build-storybook` (static build) to
  `tools/dashboard/package.json`.
- Story location and hierarchy: stories live beside the components/foundations they
  document, following the feature-local ownership already established by
  `docs/development/react-component-guidelines.md` §2.4-2.5 — e.g. foundation stories under
  a new `tools/dashboard/ui/foundations/` (or similar top-level, decided during
  implementation and named in this area's own task), chat stories beside
  `features/agent-sessions/work-v2/`. The top-level Storybook sidebar hierarchy (Storybook
  "title" per story) should read `Foundations/*`, `Components/*`, `Patterns/*` (or
  `Features/*`), `Screens/*` — final naming decided during task implementation based on
  what actually gets built, not fixed in advance of areas 4/5's real content.

## Constraints

- Dev-only: no story, addon, or Storybook config file is imported from any file reachable
  from `tools/dashboard/ui/main.tsx` — `vite build`'s output must be byte-for-byte
  unaffected by this area's changes (verified by the change-wide acceptance criterion).
- No parallel/duplicated token set, font declaration, or Tailwind config — see Requirements.
- No custom Storybook addon is created (per `overview.md` Out of scope) — Args/Controls and
  the built-in `addon-docs` are sufficient for the content this change adds.

## Interfaces and boundaries

- Consumed by `areas/testing-infrastructure.md` (needs `.storybook/main.ts` to exist before
  wiring `@storybook/addon-vitest`), `areas/foundation-stories.md`, and
  `areas/chat-stories.md` (both need the Storybook config and story-hierarchy convention to
  exist before adding their own `*.stories.tsx` files).
- Consumes: nothing beyond the existing production Vite/Tailwind/CSS setup, read-only.

## Area-specific acceptance criteria

1. `npm run storybook` (or the exact script name this task defines) starts Storybook
   locally with no errors and no live backend/AI provider running.
2. `npm run build-storybook` produces a static build with no errors.
3. A representative computed style (e.g. body font-family, a semantic color CSS custom
   property value) is identical between a running Storybook story and the production app,
   verified by rendering both and inspecting computed styles — not by comparing source/class
   names alone.
4. `vite build` (the production build) succeeds and its output is unaffected — no
   Storybook-only file appears in `tools/dashboard/dist`.
5. For every story (including the default/no-args state of each), the Storybook preview
   iframe's computed `background-color`/`background-image` on `html`/`body` and computed
   `color` on `body` match production's `index.css:63-77` values exactly — checked via
   computed styles, not source inspection. No white Canvas, white Docs-page background, or
   white initial/flash-of-unstyled paint is visible at any point, including before a story's
   own content has mounted.
6. Typography (font-family, and at least one representative font-size/line-height/weight
   combination) is verified against production the same way — computed styles, not class
   names.



## Dependencies

None. May start immediately, in parallel with `chat-surface-boundaries`.

## Out of scope

- Any story content (foundations or chat) — that's areas 4 and 5.
- Test-runner wiring (`@storybook/addon-vitest`) — that's `areas/testing-infrastructure.md`.
