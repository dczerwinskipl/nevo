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
`tools/dashboard/ui` (excluding stories, tests, fixtures, generated files) and fails on:
color-bearing arbitrary-value utilities (`bg-[var(--...)]` etc.), direct Tailwind
default-palette utilities, undeclared color-variable references, component-local
literal/`color-mix(...)` semantic colors, and interpolated Tailwind class construction
(e.g. `` `text-status-${tone}` ``, per the class-composition contract's "Tailwind source
detection" rule, D8) — wired into the existing test command.

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
6. The check passes against the real, fully-migrated `tools/dashboard/ui` tree.
   `automated: the check itself, run against tools/dashboard/ui`
7. The check runs as part of `npm --prefix tools/dashboard test` (or an equivalently
   discoverable script named in `package.json`).
   `automated: npm --prefix tools/dashboard test`
8. No new npm dependency was added.
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
