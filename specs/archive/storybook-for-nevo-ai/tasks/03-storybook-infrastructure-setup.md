---
id: storybook-for-nevo-ai.storybook-infrastructure-setup
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/owner-decisions.md
    - specs/active/storybook-for-nevo-ai/areas/storybook-infrastructure.md
    - tools/dashboard/vite.config.ts
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/main.tsx
    - tools/dashboard/tsconfig.app.json
    - tools/dashboard/package.json
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/.storybook/**
  - tools/dashboard/vite.config.ts
  - tools/dashboard/ui/foundations/**
forbidden_paths:
  - tools/dashboard/ui/features/**
  - tools/dashboard/server/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1]
  constraints: [C1, C2, C3]
---

# Task: Install and configure Storybook

## Goal

Add `storybook` + `@storybook/react-vite` + `@storybook/addon-docs` as devDependencies and
configure Storybook to build/run against `tools/dashboard/ui/`, reusing the exact production
Vite/Tailwind/CSS/font pipeline, with zero production-bundle impact.

## Dependencies

None.

## Implementation constraints

- `.storybook/main.ts`'s Vite config must reuse the same Tailwind plugin, `@` path alias,
  and Tailwind pipeline as `tools/dashboard/vite.config.ts` — either import/merge the real
  config or extract the shared pieces into something both import. Do not hand-write a
  second, parallel Tailwind/alias configuration.
- `.storybook/preview.ts(x)` must import the real `tools/dashboard/ui/index.css` — not a
  copy or subset.
- The dashboard has no light/dark toggle, theme class, data attribute, or theme
  provider/context (fact — `index.css:63-77` styles `html`/`body` unconditionally, no
  conditional selector anywhere in the codebase). The preview must therefore render every
  story directly on that unconditional production background/foreground by default — not
  merely inside a dark Storybook Canvas chrome:
  - Confirm the imported `index.css` rules actually apply to the preview iframe's real
    `html`/`body` elements, not only to a wrapper `<div>` around the story.
  - Disable or reconcile the `backgrounds` addon's own default parameter so it doesn't
    paint over/before the real background.
  - No white Canvas, white Docs-page chrome, or white initial/flash-of-unstyled paint may
    remain visible anywhere, at any point (including before a story's content mounts).
- Add `storybook` and `build-storybook` npm scripts to `tools/dashboard/package.json`
  without altering the existing `dev`/`dev:ui`/`build`/`test`/`start` scripts.
- No story/addon/config file under `.storybook/` may be imported from any file reachable
  from `tools/dashboard/ui/main.tsx`.

## Acceptance criteria

1. `npm --prefix tools/dashboard run storybook` starts Storybook locally with no errors and
   no live backend/AI provider running. `inspection: manual run, confirm no errors`
2. `npm --prefix tools/dashboard run build-storybook` produces a static build with no
   errors. `automated: npm --prefix tools/dashboard run build-storybook`
3. A representative computed style (body font-family and one semantic color custom
   property, e.g. `--success`) is identical between a running Storybook instance and the
   production dashboard, verified by inspecting rendered/computed styles (e.g. via the
   `mcp__playwright__*` tools) — not by comparing source/class names alone.
   `inspection: computed-style comparison performed and recorded`
4. `npm --prefix tools/dashboard run build` (the existing production build) still succeeds
   and its output directory contains no Storybook-only file.
   `automated: npm --prefix tools/dashboard run build`
5. For every story's default state, the preview iframe's computed `background-color`/
   `background-image` on `html`/`body` and computed `color` on `body` match production's
   `index.css:63-77` values exactly, and no white Canvas/Docs/initial-paint is visible —
   verified with the `mcp__playwright__*` tools (navigate to the story, inspect computed
   styles, take a screenshot to confirm no white surface).
   `inspection: computed-style comparison + screenshot performed and recorded`
6. Typography (font-family and at least one representative font-size/line-height/weight)
   matches production the same way. `inspection: computed-style comparison performed and recorded`

## Verification

```text
npm --prefix tools/dashboard run build-storybook
npm --prefix tools/dashboard run build
```

Manual: load a story via the `mcp__playwright__*` tools and confirm computed `html`/`body`
background and `body` text color match `index.css:63-77`, with a screenshot showing no white
surface anywhere in the preview.

## Documentation impact

None yet — documented by task 10 once this task's real script names/paths exist.

## Out of scope

- Any story content — that's tasks 05-09.
- `@storybook/addon-vitest` wiring — that's task 04.
