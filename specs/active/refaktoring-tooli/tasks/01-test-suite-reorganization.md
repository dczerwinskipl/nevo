---
id: refaktoring-tooli.test-suite-reorganization
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/test-suite-organization.md
    - docs/development/node-tooling-guidelines.md
    - docs/development/react-component-guidelines.md
    - package.json
    - tools/dashboard/package.json
  optional: []
allowed_paths:
  - package.json
  - tools/dashboard/package.json
  - tools/tests/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1]
  constraints: [C1, C2, C3]
---

# Task: Test suite reorganization

## Goal

Reorganize the flat test directories in `tools/tests/` (56 files) and `tools/dashboard/tests/` (34 files) into logical domain subdirectories, update test runner scripts in `package.json` to support recursive globs (`**/*.test.mjs`), and adjust relative import paths.

## Implementation constraints

- 100% of existing tests must be migrated and maintain full passing status.
- Test scripts `npm test` and `npm --prefix tools/dashboard test` must automatically discover and execute all tests in subdirectories.
- Ensure test helpers (`fixture-repo.test-helper.mjs`, fixtures directory) work reliably from nested subfolders.

## Acceptance criteria

1. Test files in `tools/tests/` are organized into subdirectories `cli/`, `specs/`, `lib/`, `ai/`, `docs/`, `e2e/`. `automated: node --test tools/tests/**/*.test.mjs`
2. Test files in `tools/dashboard/tests/` are organized into subdirectories `server/`, `ui/`, `view-models/`, `integration/`. `automated: npm --prefix tools/dashboard test`
3. Scripts in `package.json` and `tools/dashboard/package.json` run the full test suites. `automated: npm test && npm --prefix tools/dashboard test`
4. No test fails due to invalid relative import paths or missing fixtures. `automated: npm test && npm --prefix tools/dashboard test`

## Verification

```text
npm test
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Modifying production code in `tools/specs.mjs` or `tools/dashboard/server/`.
