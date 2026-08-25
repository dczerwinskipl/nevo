---
id: refaktoring-tooli.area.test-suite-organization
type: area
change: refaktoring-tooli
---

# Area: Test Suite Organization

## Responsibility

Manages test directory structures for repository tooling (`tools/tests/`) and dashboard (`tools/dashboard/tests/`), test runner configuration in `package.json`, and categorization of tests by responsibility layer (unit, integration, E2E, CLI boundary).

## Current state

- `tools/tests/` contains 56 test files located flat in a single directory.
- `tools/dashboard/tests/` contains 34 test files located flat in a single directory.
- Root `package.json` `"test"` script runs only `node --test tools/tests/*.test.mjs` (does not traverse subdirectories).
- Boundary layers (adapters vs pure logic vs CLI orchestration) are mixed together without structural separation.

## Requirements

- Establish a clear directory hierarchy in `tools/tests/`:
  - `tools/tests/cli/` — tests for Commander CLI options, argument validation, error mappings, and stdout/stderr output formatting.
  - `tools/tests/specs/` — tests for specification validation, task status transitions, gate rules, batch selection, provenance, and follow-ups.
  - `tools/tests/lib/` — tests for external I/O adapters (`git.mjs`, `fs.mjs`, `yaml.mjs`, `github.mjs`, `operation-progress.mjs`).
  - `tools/tests/ai/` — tests for model adapters (`antigravity`, `codex`, `claude`), turn runtime, wire protocol parsing, and session binding.
  - `tools/tests/docs/` — tests for documentation routing and index generation.
  - `tools/tests/e2e/` — end-to-end workflow and owner acceptance tests.
- Establish a clear directory hierarchy in `tools/dashboard/tests/`:
  - `tools/dashboard/tests/server/` — tests for HTTP/SSE routes, file watchers, server operations, and Git providers.
  - `tools/dashboard/tests/view-models/` — tests for pure projections, data transformations, grouping, and formatting.
  - `tools/dashboard/tests/ui/` — tests for UI components, user interactions, modals, and accessibility.
  - `tools/dashboard/tests/integration/` — integration tests for navigation, routing, and assistant runtime states.
- Update test runner scripts in `package.json` and `tools/dashboard/package.json` to use recursive globs (`**/*.test.mjs`).
- Update relative import paths in moved test files and shared test fixtures (`fixture-repo.test-helper.mjs`, fixtures directory).

## Interfaces and boundaries

Test structure does not alter production behavior, but forms the foundational verification safety harness for all subsequent refactoring tasks.

## Area-specific acceptance criteria

1. All 56 tests in `tools/tests/` are categorized and moved into domain subdirectories.
2. All 34 tests in `tools/dashboard/tests/` are categorized and moved into domain subdirectories.
3. `npm test` and `npm --prefix tools/dashboard test` discover and execute 100% of the tests recursively.
4. All test suites pass cleanly without any regression.

## Out of scope

- Rewriting assertions with alternative testing libraries.
