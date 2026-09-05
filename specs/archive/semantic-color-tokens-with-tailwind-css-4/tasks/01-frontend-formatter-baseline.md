---
id: semantic-color-tokens-with-tailwind-css-4.frontend-formatter-baseline
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/frontend-formatter-baseline.md
    - tools/dashboard/package.json
    - tools/dashboard/ui/index.css
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/prettier.config.mjs
  - tools/dashboard/.prettierignore
  - tools/dashboard/**
forbidden_paths:
  - src/**
  - docs/**
semantic_references:
  decisions: [D7]
  constraints: [C7]
---

# Task: Add Prettier + Tailwind class sorting, apply baseline formatting

## Goal

Add `prettier` and `prettier-plugin-tailwindcss` as direct devDependencies, add
`tools/dashboard/prettier.config.mjs`, `.prettierignore`, and `format`/`format:check`
scripts, then run the formatter once across `tools/dashboard` and commit the result as
one standalone mechanical commit with zero semantic change.

## Dependencies

None — this is the first task in the change.

## Implementation constraints

- Do not combine this task's formatting commit with any other change. If any other work
  is in progress in the working tree, this task's commit must contain only the
  dependency/config additions and the formatter's own output.
- Before writing `.prettierignore`, check the actual current build/Storybook-build/
  coverage/generated-router-file output paths in `tools/dashboard` (e.g. via
  `tools/dashboard/vite.config.ts`, `.storybook/main.ts`, and the TanStack Router plugin
  config) — do not guess generic path names.
- `tailwindStylesheet: './ui/index.css'` and `tailwindFunctions: ['cn', 'cva']` are
  required exactly as given so Tailwind class sorting works correctly inside both plain
  `cn()` calls and `cva()` recipes.
- Run `npm --prefix tools/dashboard run format:check` before formatting to record the
  pre-existing scope, then `npm --prefix tools/dashboard run format`, then re-run
  `format:check` to confirm it now passes.

## Acceptance criteria

1. `prettier` and `prettier-plugin-tailwindcss` appear as direct `devDependencies` in
   `tools/dashboard/package.json`. `automated: grep for both names in package.json devDependencies`
2. `tools/dashboard/prettier.config.mjs` exists with `singleQuote: true`,
   `trailingComma: 'all'`, `printWidth: 120`, `plugins: ['prettier-plugin-tailwindcss']`,
   `tailwindStylesheet: './ui/index.css'`, `tailwindFunctions: ['cn', 'cva']`, and no
   additional stylistic options. `inspection: config file reviewed`
3. `format`/`format:check` scripts exist in `package.json` and the existing scripts are
   unchanged. `automated: package.json diff reviewed`
4. `.prettierignore` excludes `node_modules`, the real build output directory, the real
   Storybook static build output directory, coverage output, and the real generated
   router-file path(s). `inspection: paths verified against actual config`
5. `npm --prefix tools/dashboard run format:check` passes.
   `automated: npm --prefix tools/dashboard run format:check`
6. The formatting commit contains no semantic change — `npm --prefix tools/dashboard
   test`, `npm --prefix tools/dashboard run build`, `npm --prefix tools/dashboard run
   test:storybook` all still pass, and a diff review confirms only
   whitespace/quote-style/class-order changed. `automated: all three commands` +
   `inspection: diff reviewed for non-mechanical changes`
7. The formatting change is isolated in its own commit — no other file changes are mixed
   in. `inspection: commit contents reviewed`

## Verification

```text
npm --prefix tools/dashboard run format:check
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
```

## Documentation impact

None.

## Out of scope

- Any semantic token or component change — every later task in this change.
- ESLint/Biome — not introduced by this task or this change.
