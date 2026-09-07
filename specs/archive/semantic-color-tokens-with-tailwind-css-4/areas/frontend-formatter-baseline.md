# Area: frontend-formatter-baseline

## Responsibility

Add a directly-declared Prettier + `prettier-plugin-tailwindcss` formatter to
`tools/dashboard`, apply it once as a repo-wide mechanical formatting pass, and land that
pass as its own commit — separate from every semantic token/component change in this
spec — so later diffs stay reviewable.

## Current state

- Prettier is **not** a direct dependency anywhere in the repo (confirmed: no `prettier`
  entry in `tools/dashboard/package.json` devDependencies or the repo-root
  `package.json`). No `.prettierrc*`/`prettier.config.*` exists at either location.
- `prettier@3.9.6` is present only *transitively*, required by `@tanstack/router-generator`
  (a dependency of the `@tanstack/router-plugin` devDependency,
  `tools/dashboard/package.json:50`) — not by Storybook, and not something the project
  can rely on directly (a transitive version can change or disappear without notice).
- No ESLint or Biome config exists anywhere in the repo (root or `tools/dashboard`) —
  confirmed by repo-wide glob, so this task introduces no conflicting/competing
  formatter.
- `class-variance-authority` (`cva`) is the existing variant-recipe convention (used in
  `button.tsx`, `sheet.tsx`) — `tailwindFunctions: ['cn', 'cva']` in the Prettier config
  must sort classes correctly inside both.

## Requirements

- Add `prettier` and `prettier-plugin-tailwindcss` as direct devDependencies of
  `tools/dashboard/package.json` — do not rely on the transitive copy pulled in by
  `@tanstack/router-generator`.
- Create `tools/dashboard/prettier.config.mjs` (ESM), containing at least:
  ```js
  /** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
  export default {
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 120,
    plugins: ['prettier-plugin-tailwindcss'],
    tailwindStylesheet: './ui/index.css',
    tailwindFunctions: ['cn', 'cva'],
  };
  ```
  Do not add stylistic options beyond this — no evidence in the current codebase
  justifies more (per the change request's explicit "keep minimal" instruction).
- Add npm scripts to `tools/dashboard/package.json`:
  ```json
  { "format": "prettier --write .", "format:check": "prettier --check ." }
  ```
  without altering existing scripts (`dev`, `dev:ui`, `build`, `test`, `start`,
  `storybook`, `build-storybook`, `test:storybook`).
- Add `tools/dashboard/.prettierignore` covering at minimum: `node_modules`, the
  production build output directory, the Storybook static build output directory,
  coverage output, generated TanStack Router files (the router plugin generates a route
  tree file — identify its actual current path/name and exclude it, do not guess a name
  that doesn't match reality), and any other repository-generator-owned output under
  `tools/dashboard` (confirm the actual current output paths before writing the ignore
  list — do not copy a generic template that doesn't match this repo).
- Run `npm --prefix tools/dashboard run format:check` first to see the real scope of the
  diff, then `npm --prefix tools/dashboard run format` once, and commit the result as one
  standalone, purely mechanical commit — no hand-edits mixed in, no semantic changes.
- If the resulting diff is broad enough that reviewing it as one commit is impractical,
  it is still one *logical* mechanical change — do not split formatting itself across
  multiple commits, but do keep it entirely separate from every other task's commits in
  this change (per D5/D7: this task's own commit(s) never mix formatting with token or
  component edits).

## Constraints

- Prettier is responsible only for deterministic formatting and Tailwind class ordering
  — it does not replace or duplicate ESLint/Biome-style architecture enforcement (that
  remains `areas/cleanup-and-enforcement.md`'s `tasks/10-*`).
- No other formatter/linter platform (e.g. Biome) is introduced.
- This task's own commit must land before any task that edits `index.css` or any
  `tools/dashboard/ui/**` source file for token/component migration — every later task
  in this change must branch from (or rebase onto) this task's completed, formatted
  baseline so its own diff is pure semantic change, not formatting noise.

## Interfaces and boundaries

- Produces: the formatting baseline every later task's diff is measured against.
- Consumes: nothing from other areas.

## Area-specific acceptance criteria

1. `prettier` and `prettier-plugin-tailwindcss` are direct `devDependencies` in
   `tools/dashboard/package.json` (not relied on transitively).
2. `tools/dashboard/prettier.config.mjs` exists with exactly the required options (no
   unjustified extras).
3. `npm --prefix tools/dashboard run format:check` passes immediately after this task's
   commit (i.e. the formatting pass was actually applied, not just configured).
4. `.prettierignore` excludes `node_modules`, build output, Storybook static build
   output, coverage output, and generated router files, verified against the actual
   current paths in the repo.
5. The formatting pass is isolated in its own commit(s), containing no semantic/behavior
   change (verified by diffing for anything beyond whitespace/quote-style/class-order).
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`, and
   `npm --prefix tools/dashboard run test:storybook` still pass after the formatting
   pass (proves it was purely mechanical).

## Dependencies

None. This is a prerequisite area — every other area's tasks depend on it (D7).

## Out of scope

- Any semantic/behavioral code change.
- ESLint, Biome, or any other lint/architecture tool — `areas/cleanup-and-enforcement.md`
  already covers the (separate, dependency-free) architecture check.
