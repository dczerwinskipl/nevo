---
id: semantic-color-tokens-with-tailwind-css-4.cleanup-and-token-removal
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/cleanup-and-enforcement.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/index.html
allowed_paths:
  - tools/dashboard/ui/**
forbidden_paths:
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
  - agent-sessions-and-work
  - specs-lanes-and-remaining-ui
  - storybook-and-documentation
semantic_references:
  decisions: [D1, D5]
  constraints: [C5, C6]
---

# Task: Final sweep, old-variable removal, `--color-*: initial`, theme-color fix

## Goal

Confirm zero remaining `-[var(--…)]`/raw-white-black/`color-mix(...)` occurrences,
remove the old `:root` color-variable block and the 5 dead token variants, add
`--color-*: initial` to `@theme`, and fix `index.html`'s `theme-color` to match
`--color-background`.

## Dependencies

Every consumer-migration task: `shared-ui-primitives`, `status-tone-contract`,
`agent-sessions-and-work`, `specs-lanes-and-remaining-ui`,
`storybook-and-documentation`.

## Implementation constraints

- Run the repo-wide sweep first; if it finds any straggler, fix it in this task (do not
  defer) and note which earlier area's task missed it.
- Remove the entire original `:root` block (all 39 variables) from `index.css` only
  after the sweep confirms zero consumers remain.
- Confirm `--success-strong`/`--info`/`--info-strong`/`--info-muted`/`--info-border`
  were never carried into the `@theme` block (Area 1 never listed them) before declaring
  them removed.
- `theme-color` in `index.html` must equal `--color-background`'s literal value
  (`#090a0d`), not be independently re-derived.

## Acceptance criteria

1. Repo-wide sweep (excluding stories/tests/fixtures) returns zero `-[var(--`, raw
   white/black, or `color-mix(` occurrences under `tools/dashboard/ui`.
   `automated: repo-wide grep with story/test/fixture exclusions`
2. The old `:root` color-variable block no longer exists in `index.css`.
   `automated: ! grep -q "^:root {" tools/dashboard/ui/index.css` (adjust to the actual
   selector syntax used)
3. `--success-strong`, `--info`, `--info-strong`, `--info-muted`, `--info-border` do not
   appear anywhere in the repository.
   `automated: ! grep -rqE "\-\-success-strong|\-\-info-strong|\-\-info-muted|\-\-info-border" tools/dashboard`
4. `--color-*: initial` is present in `@theme`.
   `automated: grep -q -- "--color-\*: initial" tools/dashboard/ui/index.css`
5. `index.html`'s `theme-color` equals `index.css`'s `--color-background` value exactly.
   `automated: values compared programmatically`
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook`, and `npm --prefix tools/dashboard
   run build-storybook` all pass.
7. Every change-wide acceptance criterion in `overview.md` is re-checked and passes.
8. Representative Storybook stories (one per migrated area) compared before/after this
   whole change, confirming neutral surfaces/typography/spacing/non-targeted states are
   unchanged except the explicitly allowed fixes.
   `inspection: before/after comparison performed and recorded`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
npm --prefix tools/dashboard run build-storybook
```

## Documentation impact

None beyond what `tasks/08-*` already updated.

## Out of scope

- The architecture-check itself — `tasks/10-architecture-enforcement-check.md`.
