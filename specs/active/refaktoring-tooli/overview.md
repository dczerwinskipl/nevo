---
id: spec.refaktoring-tooli
type: change
title: "Tools refactoring according to Node and React guidelines"
status: draft
change: refaktoring-tooli
---

# Tools refactoring according to Node and React guidelines

## Context

Two formal guideline documents establishing architecture standards for tooling and user interface code were added to the NEvo repository:
1. `docs/development/node-tooling-guidelines.md` — architectural guidelines for Node.js developer tools, CLI commands, and long-lived dashboard/server processes (thin external boundaries, module cohesion by capability, separation of pure logic and I/O effects, async process execution, structured errors, layered testing).
2. `docs/development/react-component-guidelines.md` — architectural guidelines for React UI components and dashboard frontend (composition of small, focused components, keeping data transformations out of JSX, feature-local directories, semantic tokens, Radix UI primitives, local vs server query state).

A significant portion of the existing codebase under `tools/` was built prior to these standards. As a result, several multi-thousand-line monolithic modules accumulated, test suites were organized in flat folders (56 tests in `tools/tests/` and 34 in `tools/dashboard/tests/`), CLI command handlers mixed argument parsing with application orchestration, and frontend components contained heavyweight JSX projections without clean subcomponent boundaries.

## Current architecture

- **CLI and specification engine:**
  - `tools/specs.mjs` (1855 LOC) mixes Commander option/command registration, execution logic for over 20 commands, direct Git invocations, `console.error` writes, process exit code manipulation, and AI session auto-binding.
  - `tools/specs/lifecycle.mjs` (1745 LOC) bundles task status transition validation, gate definitions, postcondition inspection, recovery algorithms, batch selection, provenance mapping, and risk detection into a single module.
  - `tools/specs/service.mjs` (1042 LOC) acts as a monolithic catch-all service module combining I/O for changes, tasks, specification indexes, fingerprint calculation, follow-up tracking, and context packet generation.
- **AI subsystem (`tools/ai/`):**
  - Adapters (`antigravity-adapter.mjs` — 1039 LOC, `turn-runtime.mjs` — 825 LOC, `codex-adapter.mjs` — 771 LOC, `claude-adapter.mjs` — 568 LOC) intertwine wire protocol encoding/decoding with child process management (`spawn`), JSON/SSE streaming, and error mapping.
- **Dashboard server backend (`tools/dashboard/server/`):**
  - `index.mjs` (559 LOC) and `data.mjs` (595 LOC) combine HTTP/SSE route registration, static file serving, specification parsing, Git diff hydration, and process execution in route handlers.
- **Dashboard frontend (`tools/dashboard/src/`):**
  - `lib/nevo-assistant-runtime.ts` (953 LOC) is a monolithic adapter managing assistant-ui integration, message state machines, event mapping, and local dispatch stores.
  - `components/spec-detail.tsx` (784 LOC) and `components/changes-panel.tsx` (676 LOC) embed complex tab navigation, task editors, follow-up views, diff viewers, and extensive data transformations directly inside monolithic JSX files.
  - `hooks/use-dashboard-data.ts` (706 LOC) combines queries and mutations for the entire application in a single global hook file.
- **Test suite organization:**
  - `tools/tests/` contains 56 test files placed flat in one directory without domain separation (CLI, specs, ai, lib, docs, e2e).
  - `tools/dashboard/tests/` contains 34 test files placed flat in one directory without separation (server, UI, view-models, integration).

## Problem & Motivation

1. **High cognitive load and maintenance friction:** Monolithic files between 500 and 1855 lines make changes error-prone, slow down automated agents and human developers, and increase merge conflict risk.
2. **Violation of single responsibility:** Coupling CLI presentation concerns with core business logic and external I/O prevents direct reuse across CLI and dashboard HTTP routes without duplication or spawning child processes.
3. **Flat test organization:** Flat test directories obscure layer boundaries (unit vs integration vs E2E) and prevent running targeted domain subsuites during focused development.
4. **Non-conformance with Node and React guidelines:** Frontend components perform data transformations inside JSX rather than utilizing pure view-models, and server handlers risk event-loop blocking on request paths.

## Constraints

- **C1.** Full backward compatibility of external contracts: all existing CLI commands, options, machine-readable stdout/stderr formats, exit codes, HTTP routes, SSE streams, and dashboard UI interactions must behave identically.
- **C2.** No ceremonial or forwarding layers: decomposition must follow cohesive capabilities and real ownership boundaries, avoiding artificial boilerplate layers (e.g. `Command -> Handler -> Service -> Manager -> Repository`).
- **C3.** Test suite completeness: 100% of existing tests must continue to pass without regression; test restructuring must mirror module architecture.
- **C4.** Module size and responsibility limits: modules approaching 300–500 LOC serve as review triggers and must be decomposed into focused, single-responsibility files.
- **C5.** Thin external boundaries: CLI entrypoints (`tools/specs.mjs`, `tools/docs.mjs`) and HTTP handlers must only parse/validate input, delegate to application operations, and format output.
- **C6.** Pure logic separated from external I/O: decision algorithms, transition validations, fingerprinting, and view-model projections must remain pure functions, easily unit-testable without filesystem/Git mocking.
- **C7.** Async and child process safety: no blocking synchronous process/FS calls on server request paths; child processes must have explicit lifecycle ownership, timeouts, and `AbortSignal` cancellation.
- **C8.** Clean React UI architecture: small focused components, data projections kept outside JSX, semantic Tailwind tokens, and accessible Radix primitives.

## Affected Areas

- `tools/specs.mjs`, `tools/specs/**`
- `tools/lib/**`
- `tools/ai/**`
- `tools/dashboard/server/**`
- `tools/dashboard/src/**`
- `tools/tests/**`
- `tools/dashboard/tests/**`
- `package.json`, `tools/dashboard/package.json`

## Options and Trade-offs

### Option 1: Incremental domain decomposition with test reorganization first (Selected — Recommended)
- **Description:** First reorganize test directories into semantic subdirectories (`cli/`, `specs/`, `lib/`, `ai/`, `docs/`, `e2e/` and `server/`, `ui/`, `view-models/`, `integration/`) and configure recursive test globs (`**/*.test.mjs`) in `package.json`. Next, systematically decompose modules in `tools/specs/`, `tools/ai/`, `tools/dashboard/server/`, and `tools/dashboard/src/`, validating each domain with its dedicated test suite.
- **Pros:** Provides immediate verification safety harness; guarantees no hidden regressions; cleanly isolates domain boundaries.
- **Cons:** Requires updating relative imports in test files during the initial task.

### Option 2: Ad-hoc code and test refactoring per module
- **Description:** Move and split tests concurrently as each production module is touched.
- **Pros:** Smaller initial commit diff.
- **Cons:** Leaves test directory in an inconsistent state during most of the refactor; harder to guard against regressions in shared libraries (`tools/lib/`).

## Owner Decisions

- **D1.** Reorganize test suites into domain-oriented subdirectories with recursive glob discovery (`**/*.test.mjs`) in `package.json` and `tools/dashboard/package.json`.
- **D2.** Decompose `tools/specs.mjs` into a thin CLI parser, extract command handlers into `tools/specs/commands/*`, break `lifecycle.mjs` into `tools/specs/lifecycle/*`, and split `service.mjs` into domain store/index modules.
- **D3.** Decouple pure wire protocol translation from child process execution and streaming in `tools/ai/`, standardizing `AbortSignal` cancellation and structured errors.
- **D4.** Modularize dashboard server into thin route controllers with shared application operations; decompose frontend view monoliths (`spec-detail.tsx`, `changes-panel.tsx`, `ai-chat.tsx`, `nevo-assistant-runtime.ts`) and global query hook (`use-dashboard-data.ts`) into feature-local component trees and pure view-model projections.

## Proposed Target Architecture

```text
tools/
├── specs.mjs                     # Thin Commander CLI entrypoint (< 200 LOC)
├── docs.mjs                      # Thin docs CLI entrypoint (< 200 LOC)
├── specs/
│   ├── commands/                 # Command operation handlers (start, approve, finalize, status, etc.)
│   ├── lifecycle/                # Lifecycle capability modules (transitions, recovery, batch, provenance, stage)
│   ├── store/                    # Change and task filesystem persistence
│   ├── context.mjs               # Task context packet construction
│   ├── fingerprint.mjs           # Fingerprint calculations
│   ├── indexes.mjs               # Specification index generation and validation
│   ├── follow-ups.mjs            # Follow-up ledger persistence
│   ├── gates.mjs                 # Workflow gate evaluations
│   └── validation.mjs            # Manifest and spec schema validation
├── ai/
│   ├── adapters/                 # Model provider adapters (antigravity, codex, claude, mock)
│   ├── protocol/                 # Pure protocol encoders/decoders and parsers
│   ├── turn-runtime.mjs          # Turn lifecycle state machine
│   ├── binding-service.mjs       # Agent session binding service
│   └── contracts.mjs             # AI schemas and event contracts
├── lib/                          # Shared I/O adapters (git, fs, github, errors, yaml)
├── dashboard/
│   ├── server/
│   │   ├── routes/               # Thin HTTP/SSE route handlers
│   │   ├── operations.mjs        # Long-running operation runtime with cancellation
│   │   └── data.mjs              # Data projection for dashboard views
│   └── src/
│       ├── components/
│       │   ├── spec-detail/      # Decomposed specification detail components
│       │   ├── changes-panel/    # Decomposed pull request and diff components
│       │   ├── ai-chat/          # Decomposed assistant chat components
│       │   └── ui/               # Reusable UI primitives and Radix wrappers
│       ├── hooks/                # Domain-focused hooks (use-specs, use-changes, use-operations)
│       └── lib/                  # Pure view-models and data projections
└── tests/
    ├── cli/                      # CLI argument parsing, flags, and exit code tests
    ├── specs/                    # Specification lifecycle, gates, and validation tests
    ├── ai/                       # AI adapter, protocol, and turn runtime tests
    ├── lib/                      # Git, FS, and YAML adapter tests
    ├── docs/                     # Documentation routing and index tests
    └── e2e/                      # End-to-end workflow acceptance tests
```

## Compatibility & Migration

The refactoring preserves 100% backward compatibility for all external boundaries:
1. All `node tools/specs.mjs <command>` and `node tools/docs.mjs <command>` invocations maintain identical arguments, outputs, and exit codes.
2. HTTP endpoints and SSE streams on the dashboard server maintain identical JSON schemas and event types.
3. All active and archived specifications in `specs/active/` and `specs/archive/` continue to validate cleanly.

## Areas

- `areas/test-suite-organization.md` — test directory structure, runner configuration, and categorization.
- `areas/specs-core-and-lifecycle.md` — decomposition of `service.mjs` and `lifecycle.mjs` into cohesive modules.
- `areas/cli-architecture.md` — thinning `tools/specs.mjs` and extracting command handlers to `specs/commands/`.
- `areas/ai-subsystem-and-adapters.md` — separation of protocol parsing, process lifecycle, and session binding.
- `areas/dashboard-server-backend.md` — HTTP/SSE route modularization, shared orchestration, and cancellation support.
- `areas/dashboard-frontend-and-runtime.md` — UI component decomposition, domain query hooks, and pure view-models.

## Change-wide Acceptance Criteria

1. Test directory structures under `tools/tests/` and `tools/dashboard/tests/` are organized by domain responsibility. `automated: npm test && npm --prefix tools/dashboard test`
2. `tools/specs.mjs` serves strictly as a CLI registrar and parser (< 300 LOC), delegating execution to dedicated command handlers. `automated: node --test tools/tests/cli/*.test.mjs`
3. Monolithic modules `lifecycle.mjs` and `service.mjs` are split into cohesive single-responsibility modules (< 300–400 LOC each). `automated: node --test tools/tests/specs/*.test.mjs`
4. AI adapters in `tools/ai/` decouple pure protocol mapping from process execution and handle `AbortSignal` cancellation. `automated: node --test tools/tests/ai/*.test.mjs`
5. Dashboard server features modular HTTP/SSE routes, avoids blocking synchronous calls on request paths, and shares application operations with CLI. `automated: npm --prefix tools/dashboard test`
6. Frontend components (`spec-detail`, `changes-panel`, `ai-chat`), assistant runtime, and `use-dashboard-data` hook are decomposed into small, focused modules. `automated: npm --prefix tools/dashboard run build && npm --prefix tools/dashboard test`
7. No functional regressions across any existing tools, commands, or dashboard views. `automated: npm test && npm --prefix tools/dashboard test && node tools/specs.mjs validate && node tools/docs.mjs validate`

## Verification Strategy

- **Node Automated Tests:** Full test suite execution with `npm test`.
- **Dashboard Automated Tests:** Dashboard test suite execution with `npm --prefix tools/dashboard test`.
- **TypeScript Build Validation:** Frontend type check and production bundling with `npm --prefix tools/dashboard run build`.
- **Repository Integrity Validation:** Specification and documentation verification (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`, `node tools/specs.mjs check`).
- **Guidelines Audit:** Checklist verification against `node-tooling-guidelines.md` and `react-component-guidelines.md`.
