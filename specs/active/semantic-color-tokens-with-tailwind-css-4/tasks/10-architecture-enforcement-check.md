---
id: semantic-color-tokens-with-tailwind-css-4.architecture-enforcement-check
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/cleanup-and-enforcement.md
    - tools/dashboard/tests/composer-interaction.test.mjs
    - tools/dashboard/package.json
allowed_paths:
  - tools/dashboard/tests/**
  - tools/dashboard/scripts/**
  - tools/dashboard/package.json
forbidden_paths:
  - tools/dashboard/ui/**
  - src/**
depends_on:
  - cleanup-and-token-removal
semantic_references:
  decisions: [D5, D8]
  constraints: [C4, C6, C8]
---

# Task: Add the color-token architecture enforcement check

## Goal

Add a lightweight, dependency-free check that scans production UI sources under
`tools/dashboard/ui` (excluding stories, tests, fixtures, generated files) and fails on,
**across both TS/TSX and CSS**: color-bearing arbitrary-value utilities
(`bg-[var(--...)]`, `ring-[var(--...)]`, `outline-[var(--...)]`, `fill-[var(--...)]`,
`stroke-[var(--...)]`, `caret-[var(--...)]`, etc. — not just `bg`/`text`/`border`),
direct Tailwind default-palette utilities, undeclared `--color-*` variable references,
component-local literal/`color-mix(...)` semantic colors, interpolated Tailwind class
construction (e.g. `` `text-status-${tone}` ``, per D8's "Tailwind source detection"
rule), **legacy (pre-migration) CSS custom-property references in `.css` files** (the
gap that let `index.css`'s own embedded `var(--accent)`-style references go undetected
by this spec's original TS/TSX-only discovery), and **`text-accent-solid`** (or
equivalent use of the fill-only `accent-solid` token as text, D4) — wired into the
existing test command.

## Dependencies

`cleanup-and-token-removal` (must run once the codebase is actually clean, or the check
would fail immediately against legitimate remaining work).

## Implementation constraints

- Plain Node script or a `node --test` file — no new npm package. This follows the
  existing `tools/dashboard/tests/*.test.mjs` regex-over-source-text precedent (e.g.
  `composer-interaction.test.mjs:246`), not a new ESLint installation, since a new
  dependency would need separate owner approval under `AGENTS.md` and the change request
  only asks for a "lightweight" check.
  - **Note:** if this is later found insufficient — e.g. false negatives from
    non-obvious color-utility spellings — introducing ESLint (or another new
    dependency) is an owner decision, not a call this task can make unilaterally; escalate
    rather than adding it silently.
- Explicit, minimal exception list for genuinely dynamic CSS custom properties or
  one-off decorative global CSS — document each exception inline with a one-line reason.
- Scope: production sources under `tools/dashboard/ui` only. Exclude `*.stories.tsx`,
  `tests/`, `__fixtures__/`, and any generated file.
- The CSS-file legacy-reference check needs a maintained list of legacy variable names
  (the original 39, from `overview.md` § Current architecture) to flag — a `.css` file
  referencing any of them via `var(--legacy-name)` fails; referencing a `--color-*` name
  is fine, including inside `color-mix(...)` (the documented selector-oriented-CSS
  exception covers the construct, not specific variable names).
- The `text-accent-solid`-as-text check is a targeted regex/string search for
  `text-accent-solid` (and, if the final Button/StatusCard implementation introduced a
  differently-named fill-only class, that name too — confirm the actual class name in
  use at implementation time) anywhere outside the one legitimate case: a filled
  control's own background declaration pairs with `text-fg-on-accent`, never with
  `accent-solid` as the text color itself.
- Wire the check into `npm --prefix tools/dashboard test` (or add a clearly-named script
  invoked by CI-equivalent tooling) — it must not be a check nobody runs.

## Acceptance criteria

1. A synthetic fixture containing `bg-[var(--foo)]` fails the check.
   `automated: fixture-based test`
2. A synthetic fixture containing `bg-white`/`text-blue-500` fails the check.
   `automated: fixture-based test`
3. A synthetic fixture referencing an undeclared `--color-*` variable fails the check.
   `automated: fixture-based test`
4. A synthetic fixture containing a repeated `color-mix(...)` recipe fails the check.
   `automated: fixture-based test`
5. A synthetic fixture containing an interpolated Tailwind class (e.g.
   `` `text-status-${tone}` ``) fails the check. `automated: fixture-based test`
6. A synthetic fixture containing `ring-[var(--foo)]`, `fill-[var(--foo)]`, or
   `stroke-[var(--foo)]` fails the check. `automated: fixture-based test`
7. A synthetic `.css` fixture containing `var(--accent)` (a legacy name) fails the
   check; the same fixture using `var(--color-accent)` passes.
   `automated: fixture-based test`
8. A synthetic fixture containing `text-accent-solid` fails the check.
   `automated: fixture-based test`
9. The check passes against the real, fully-migrated `tools/dashboard/ui` tree
   (including `index.css`). `automated: the check itself, run against tools/dashboard/ui`
10. The check runs as part of `npm --prefix tools/dashboard test` (or an equivalently
    discoverable script named in `package.json`).
    `automated: npm --prefix tools/dashboard test`
11. No new npm dependency was added.
    `inspection: package.json diff reviewed`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run format:check
```

## Documentation impact

None required, but a one-line mention in the UX/color doc (from `tasks/08-*`) noting the
check exists is reasonable if that doc already lists related tooling.

## Out of scope

- ESLint or any other new lint dependency — escalate to the owner if the plain check
  proves insufficient, do not add unilaterally.
