---
id: spec.refaktoring-tooli
type: change
title: "Tools refactoring according to Node and React guidelines"
status: draft
change: refaktoring-tooli
---

# Tools refactoring according to Node and React guidelines

## Context

Two architectural guideline documents have been established for the repository:
1. `docs/development/node-tooling-guidelines.md` — guidelines for Node developer tooling, CLI commands, and long-lived dashboard/server processes.
2. `docs/development/react-component-guidelines.md` — guidelines for React UI code and dashboard frontend architecture.

**Repository context:** The NEvo repository is primarily a .NET project. Node tooling, the developer dashboard, and the AI orchestration layer currently live in this repository for end-to-end testing and development efficiency, with a planned eventual migration to a dedicated tooling repository.

This specification aims to refactor the existing `tools/dashboard` and relevant Node tooling in `tools/` to align with the current development guidelines, resolving concrete architectural issues while preserving all existing behaviors, public CLI contracts, and HTTP/SSE interfaces.

**Scope boundaries & parallel specifications:**
- The AI provider adapter layer (`tools/ai/**`) is actively covered and hardened by the parallel architectural draft `specs/active/ai-adapters-hardening/`. To avoid competing refactoring streams in the same codebase, broad AI adapter redesign is explicitly out of scope for this change.
- Wholesale test directory reorganization has been removed in favor of responsibility-aligned test maintenance alongside production refactors.

## Current architecture & Concrete problems

1. **Duplicate execution paths and blocking server I/O:**
   - In `tools/dashboard/server/actions.mjs`, evaluating task and finalize gates invokes `execFileSync` to run `node tools/specs.mjs <action> <slug> --check` synchronously on the HTTP request path.
   - Spawning the project's own CLI as a subprocess to execute internal operations duplicates execution paths and blocks the Node event loop on HTTP request handlers (§2.3, §9.2 of `node-tooling-guidelines.md`).
2. **Coupling of CLI boundaries and application orchestration:**
   - `tools/specs.mjs` mixes Commander command and option definitions with deep application workflow logic, direct `console.log` / `console.error` writes, and process exit code mutations across 20+ commands (§2.1, §11, §12).
3. **Monolithic capability bags in specs lifecycle:**
   - `tools/specs/lifecycle.mjs` and `tools/specs/service.mjs` combine disparate capabilities (status transitions, postcondition recovery, batch selection, provenance mapping, index generation, and filesystem persistence) without clear separation between pure decision logic and external I/O (§3, §5, §6).
4. **Server route mixing:**
   - `tools/dashboard/server/index.mjs` and `data.mjs` combine HTTP server bootstrap, static file serving, route registration, and data formatting in route handlers rather than thin boundary controllers (§2.2).
5. **Monolithic query hooks and runtime state:**
   - `tools/dashboard/src/hooks/use-dashboard-data.ts` is a global catch-all hook mixing unrelated domain queries (specifications, pull requests/diffs, operations, AI sessions) (§6.2 of `react-component-guidelines.md`).
   - `lib/nevo-assistant-runtime.ts` conflates `@assistant-ui/react` UI adapter bindings with raw SSE stream parsing, local dispatch stores, and message state machines (§8.1).
6. **Feature components with mixed interaction and projection concerns:**
   - `components/spec-detail.tsx`, `components/changes-panel.tsx`, and `components/ai-chat.tsx` bundle multiple independent responsibilities: embedded modal dialogs with independent interaction/focus lifecycles, heavy data transformation/grouping inside JSX, and viewport/scroll tracking, obscuring page-level composition (§1.1, §2.3, §2.4, §7).

## Constraints

- **C1.** Full backward compatibility of external contracts: all existing CLI commands, options, machine-readable stdout/stderr formats, exit codes, HTTP routes, SSE streams, and dashboard UI interactions must behave identically.
- **C2.** No ceremonial or forwarding layers: decomposition must follow cohesive capabilities and real ownership boundaries, avoiding artificial boilerplate layers (e.g. `Command -> Handler -> Service -> Manager -> Repository`).
- **C3.** Test suite completeness: 100% of existing tests must continue to pass without regression; tests are updated or moved only when a new responsibility boundary makes their current location nonsensical.
- **C4.** No mechanical LOC rules: file size serves solely as an inspection trigger; every refactoring step must solve a concrete architectural problem (lifecycle, interaction ownership, pure vs IO separation, blocking calls).
- **C5.** Thin external boundaries: CLI entrypoints (`tools/specs.mjs`, `tools/docs.mjs`) and HTTP handlers must only parse/validate input, delegate to application operations, and format output.
- **C6.** Pure logic separated from external I/O: decision algorithms, transition validations, fingerprinting, and view-model projections must remain pure functions, easily unit-testable without filesystem/Git mocking.
- **C7.** Async and child process safety: no blocking synchronous process/FS calls on server request paths; long-running operations must have explicit lifecycle ownership, timeouts, and `AbortSignal` cancellation.
- **C8.** Clean React UI architecture: small focused components, data projections kept feature-local and outside JSX, semantic Tailwind tokens, and accessible Radix primitives.

## Affected Areas

- `tools/specs.mjs`, `tools/specs/**`
- `tools/dashboard/server/**`
- `tools/dashboard/src/**`
- `tools/tests/**`
- `tools/dashboard/tests/**`

## Owner Decisions

- **D1.** Eliminate blocking `execFileSync` invocations in `tools/dashboard/server/actions.mjs` by extracting shared application operations for gate evaluation and action checks, consumed directly by both CLI and dashboard server without subprocesses.
- **D2.** Separate `tools/specs.mjs` into a thin CLI parsing and output mapping boundary, extracting command orchestration into application modules.
- **D3.** Decouple pure decision logic from filesystem I/O in `tools/specs/lifecycle.mjs` and modularize `tools/specs/service.mjs` by cohesive capability, migrating internal callers and keeping compatibility re-exports only where real callers require them.
- **D4.** Modularize dashboard server routes and decompose frontend feature monoliths (`use-dashboard-data.ts`, `nevo-assistant-runtime.ts`, `spec-detail.tsx`, `changes-panel.tsx`, `ai-chat.tsx`) into domain hooks, feature-local view-models, and focused composable subcomponents.

## Illustrative Architectural Boundaries

> **Note:** The module breakdown below is an illustrative example of cohesive capability boundaries, not a rigid directory layout that must be implemented mechanically. Final file and module placement is chosen during task implementation using the smallest cohesive responsibility boundary required by the code and the applicable guideline.

```text
tools/
├── specs.mjs                     # Thin Commander CLI entrypoint
├── docs.mjs                      # Thin docs CLI entrypoint
├── specs/
│   ├── commands/                 # Command orchestration handlers (illustrative: start, approve, finalize)
│   ├── lifecycle/                # Pure lifecycle capability modules (illustrative: transitions, recovery, batch, stage)
│   ├── store/                    # Change and task filesystem persistence
│   ├── context.mjs               # Task context packet construction
│   ├── fingerprint.mjs           # Pure fingerprint calculations
│   ├── indexes.mjs               # Specification index generation
│   ├── follow-ups.mjs            # Follow-up ledger persistence
│   └── gates.mjs                 # Reusable workflow gate evaluations (shared with server)
├── lib/                          # Shared I/O adapters (git, fs, github, errors, yaml)
├── dashboard/
│   ├── server/
│   │   ├── routes/               # Thin HTTP/SSE route handlers (illustrative)
│   │   ├── actions.mjs           # Non-blocking action execution reusing shared spec operations
│   │   ├── operations.mjs        # Long-running operation runtime with cancellation
│   │   └── data.mjs              # Data projection for dashboard views
│   └── src/
│       ├── components/
│       │   ├── spec-detail/      # Decomposed specification detail components and dialogs (feature-local)
│       │   ├── changes-panel/    # Decomposed pull request and diff components (feature-local)
│       │   ├── ai-chat/          # Decomposed assistant chat components (feature-local)
│       │   └── ui/               # Reusable UI primitives and Radix wrappers
│       ├── hooks/                # Domain-focused query hooks (use-specs, use-changes, use-operations)
│       └── lib/                  # Shared cross-feature utilities and view-models
└── tests/                        # Layered test suites maintained at responsibility boundaries
```

## Areas

- `areas/specs-core-and-lifecycle.md` — shared application operations, gate evaluations, and pure lifecycle logic.
- `areas/cli-architecture.md` — thin CLI boundary, command dispatching, and output/exit contracts.
- `areas/dashboard-server-runtime.md` — server route modularization, non-blocking execution, and direct operation reuse.
- `areas/dashboard-frontend-architecture.md` — domain query hooks, feature-local view-models, component composition, and modal lifecycles.

## Change-wide Acceptance Criteria

1. Dashboard server actions (`tools/dashboard/server/actions.mjs`) no longer execute blocking `execFileSync` calls or spawn CLI subprocesses for gate evaluations, calling shared application operations directly. `automated: npm --prefix tools/dashboard test`
2. `tools/specs.mjs` serves strictly as a CLI entrypoint, delegating orchestration to reusable command modules and managing stdout/stderr/exit codes at the boundary. `automated: node --test tools/tests/*.test.mjs`
3. Pure lifecycle decision logic (transitions, recovery postconditions, stage derivation, fingerprinting) is separated from file/Git side effects and covered by unit tests. `automated: node --test tools/tests/*.test.mjs`
4. Dashboard server HTTP and SSE routes are organized into thin route modules with request validation and proper cleanup. `automated: npm --prefix tools/dashboard test`
5. `use-dashboard-data.ts` is split into domain-specific query hooks, and assistant runtime event mapping is separated from UI adapter state. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`
6. Complex feature components (`spec-detail`, `changes-panel`, `ai-chat`) have their independent interaction contracts (dialogs, drawers) and feature-local data projections extracted out of main orchestration JSX. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`
7. All existing functionality, CLI commands, HTTP routes, SSE events, and dashboard UI behavior remain 100% backward compatible without regressions. `automated: npm test && npm --prefix tools/dashboard test && node tools/specs.mjs validate && node tools/docs.mjs validate`
8. All guideline checklist items for the modules and boundaries touched by this specification are satisfied; pre-existing issues outside this change's scope are recorded in `follow-ups.yaml` without blocking completion. `inspection: checklist audit`

## Verification Strategy

- **Node Automated Tests:** Full test suite execution with `npm test`.
- **Dashboard Automated Tests:** Dashboard test suite execution with `npm --prefix tools/dashboard test`.
- **TypeScript Build Validation:** Frontend type check and production bundling with `npm --prefix tools/dashboard run build`.
- **Repository Integrity Validation:** Specification and documentation verification (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`, `node tools/specs.mjs check`).
- **Guidelines Audit:** Focused checklist verification against `node-tooling-guidelines.md` and `react-component-guidelines.md` for modules modified in this specification.
