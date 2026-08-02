---
id: nevo-documentation-foundation.doc-taxonomy-and-tooling
status: draft
change: nevo-documentation-foundation
context:
  required:
    - ../../../tools/docs.mjs
    - specs/active/nevo-documentation-foundation/owner-decisions.md
  optional:
    - ../../../docs/index.generated.json
allowed_paths:
  - tools/docs.mjs
  - docs/packages/**
  - docs/guides/**
  - docs/templates/**
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - README.md
---

# Task: Documentation taxonomy and tooling

## Goal

Extend `tools/docs.mjs` with the `package` and `guide` document types decided in D1
(`owner-decisions.md`), and create the directory structure the rest of this change
writes into. This task creates structure only — no package or guide content yet.

## Implementation constraints

- Add `package` and `guide` entries to `REQUIRED_FIELDS` in `tools/docs.mjs`
  (`tools/docs.mjs:15-21`). Do not change the required fields of any existing type
  (`architecture`, `development`, `adr`, `ai`, `change`) — additive only, per D1.
- Suggested required fields: `package` → `['id', 'type', 'title', 'status',
  'dependencies', 'summary']`; `guide` → `['id', 'type', 'title', 'status', 'summary']`.
  Adjust if a field proves unnecessary once area 03's pilot docs are drafted — this is an
  implementation detail, not a re-opened owner decision.
- Create empty (or `.gitkeep`-only) `docs/packages/` and `docs/guides/` directories.
- Create `docs/templates/` holding skeleton documents for the `package` and `guide`
  shapes (e.g. `docs/templates/package-doc-template.md`,
  `docs/templates/guide-doc-template.md`). These must have **no YAML front matter block**
  so `tools/docs.mjs`'s scanner (`parseFrontMatter`, `tools/docs.mjs:25-29`) skips them
  silently rather than trying to validate a template as a real document.
- Do not modify `docs/index.generated.md` or `docs/index.generated.json` directly — they
  are generated files; running `node tools/docs.mjs generate` regenerates them safely
  once content exists (no content exists yet in this task, so generation should show 0
  new documents).

## Acceptance criteria

- `node tools/docs.mjs validate` passes after the change (no documents use the new types
  yet, so this mainly proves the schema addition doesn't break existing validation).
- `docs/packages/`, `docs/guides/`, `docs/templates/` exist.
- `docs/templates/package-doc-template.md` and `docs/templates/guide-doc-template.md`
  exist and have no front matter (confirm `node tools/docs.mjs find --format json`
  does not list them).

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json   # expect []
node tools/docs.mjs find --type guide --format json     # expect []
```

## Documentation impact

This task's entire output is documentation tooling and structure — no separate impact
section needed.

## Out of scope

Writing the package-classification document or the navigation hub (task
`package-classification-and-navigation-hub`). Any package or guide content.
