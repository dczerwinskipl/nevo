---
id: nevo-documentation-foundation.navigation-and-validation
status: draft
change: nevo-documentation-foundation
context:
  required:
    - docs/README.md
    - docs/packages/classification.md
allowed_paths:
  - docs/README.md
  - docs/packages/**
  - docs/guides/**
  - docs/architecture/**
  - docs/development/**
  - docs/ai/**
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - tools/**
  - docs/architecture/overview.md
---

# Task: Navigation and final validation

## Goal

Cross-link the completed documentation set from the hub, and run the full validation
suite across everything this change touched.

## Dependencies

`exampleapp-walkthrough-guide`, `quickstart-and-installation-guide`,
`developer-and-extension-guides` (must be the last task — depends on every content task).

## Implementation constraints

- Update `docs/README.md` (from `package-classification-and-navigation-hub`) to link
  every document created by this change: all 13 `docs/packages/*.md`, all
  `docs/guides/*.md`, plus its existing links to `docs/architecture/*` and
  `docs/development/*`.
- Run `node tools/docs.mjs generate` then fix any validation error before re-running.
- Check every `related`/cross-link reference across all documents touched by this change
  resolves to an existing document id — fix broken references rather than removing the
  link.

## Acceptance criteria

- `node tools/docs.mjs validate` passes.
- `node tools/docs.mjs check` reports indexes current.
- `node tools/specs.mjs validate` reports no errors for this change.
- `docs/README.md` links to all 13 package docs and all guides.
- No unresolved `related`/cross-link reference remains in any document this change
  created or modified.

## Verification

```
node tools/docs.mjs generate
node tools/docs.mjs validate
node tools/docs.mjs check
node tools/specs.mjs validate
```

## Out of scope

Writing any new content — this task only links and validates what prior tasks produced.
