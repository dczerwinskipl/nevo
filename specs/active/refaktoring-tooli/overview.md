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

This specification aims to refactor the existing `tools/dashboard` and relevant Node tooling in `tools/` to align with the current development guidelines, organizing code by cohesive capabilities and feature-local vertical ownership while preserving all existing behaviors, public CLI contracts, and HTTP/SSE interfaces.

**Scope boundaries & parallel specifications:**
- The AI provider adapter layer (`tools/ai/**`) is actively covered and hardened by the parallel architectural draft `specs/active/ai-adapters-hardening/`. To avoid competing refactoring streams in the same codebase, broad AI adapter redesign is explicitly out of scope for this change.
- Wholesale test directory reorganization has been removed in favor of responsibility-aligned test maintenance alongside production refactors.

## Current architecture & Concrete problems

1. **Duplicate execution paths and blocking server I/O:**
   - In `tools/dashboard/server/actions.mjs`, evaluating task and finalize gates invokes `execFileSync` to run `node tools/specs.mjs <action> <slug> --check` synchronously on the HTTP request path (`GET /api/specs/active/:slug/actions`), spawning multiple child processes per request.
   - Spawning the project's own CLI as a subprocess to execute internal operations duplicates execution paths and blocks the Node event loop on HTTP request handlers (§2.3, §9.2 of `node-tooling-guidelines.md`).
2. **Coupling of CLI boundaries and application orchestration:**
   - `tools/specs.mjs` mixes Commander command and option definitions with deep application workflow logic, direct `console.log` / `console.error` writes, and process exit code mutations across 20+ commands (§2.1, §11, §12).
3. **Monolithic capability bags in specs lifecycle:**
   - `tools/specs/lifecycle.mjs` and `tools/specs/service.mjs` combine disparate capabilities (status transitions, postcondition recovery, batch selection, provenance mapping, index generation, and filesystem persistence) without clear separation between pure decision logic and external I/O (§3, §5, §6).
4. **Server route mixing:**
   - `tools/dashboard/server/index.mjs` and `data.mjs` combine HTTP server bootstrap, static file serving, route registration, and data formatting in route handlers rather than thin boundary controllers (§2.2).
5. **Horizontal scattering across frontend features:**
   - Instead of feature-local vertical ownership, frontend code is scattered horizontally across global files:
     - `tools/dashboard/src/hooks/use-dashboard-data.ts` is a monolithic global hook mixing queries for specifications, diffs, operations, and AI sessions. Internal callers should migrate directly to feature-owned query APIs, removing redundant forwarding exports once migration completes.
     - `tools/dashboard/src/lib/` contains feature-specific helpers and projections (`chat-projection.ts`, `ai-chat-helpers.ts`, `changes-grouping.ts`, `use-scroll-follow.ts`, `pending-dispatch-store.ts`) that belong vertically to their respective feature slices.
     - In `spec-detail.tsx`, document/section projection and tab resolution are intermingled with overview composition, operation modal state, and batch polling orchestration.
     - In `changes-panel.tsx`, pull request selection, hierarchical file tree rendering, progressive hydration queues, and diff viewer controls are mixed together.
     - In `ai-chat.tsx`, visual viewport/keyboard tracking (`useChatVisualViewport`) and session creation (`CreateAiSessionDialog`) are bundled with page layout orchestration, while `nevo-assistant-runtime.ts` conflates message state transitions, SSE subscriptions, HTTP turn operations, and UI adapter bridge bindings.

## Constraints

- **C1.** Full backward compatibility of external contracts: all existing CLI commands, options, machine-readable stdout/stderr formats, exit codes, HTTP routes, SSE streams, and dashboard UI interactions must behave identically.
- **C2.** No ceremonial or forwarding layers: decomposition must follow cohesive capabilities and real ownership boundaries, avoiding artificial boilerplate layers (e.g. `Command -> Handler -> Service -> Manager -> Repository`).
- **C3.** Test suite completeness: 100% of existing tests must continue to pass without regression; tests are updated or moved only when a new responsibility boundary makes their current location nonsensical.
- **C4.** No mechanical LOC rules: file size serves solely as an inspection trigger; every refactoring step must solve a concrete architectural problem (lifecycle, interaction ownership, pure vs IO separation, blocking calls).
- **C5.** Thin external boundaries: CLI entrypoints (`tools/specs.mjs`, `tools/docs.mjs`) and HTTP handlers must only parse/validate input, delegate to application operations, and format output.
- **C6.** Pure logic separated from external I/O: decision algorithms, transition validations, fingerprinting, and view-model projections must remain pure functions, easily unit-testable without filesystem/Git mocking.
- **C7.** Async and child process safety: no blocking synchronous process/FS calls on server request paths; long-running operations must have explicit lifecycle ownership, timeouts, and `AbortSignal` cancellation.
- **C8.** Clean React UI architecture: small focused components, feature-local vertical ownership for components/hooks/projections, semantic Tailwind tokens, and accessible Radix primitives.

## Affected Areas

- `tools/specs.mjs`, `tools/specs/**`
- `tools/dashboard/server/**`
- `tools/dashboard/src/**`
- `tools/tests/**`
- `tools/dashboard/tests/**`

## Owner Decisions

- **D1.** Eliminate blocking `execFileSync` invocations in `tools/dashboard/server/actions.mjs` by extracting shared application operations for gate evaluation and action checks, consumed directly in-process by both CLI and dashboard server without subprocesses.
- **D2.** Separate `tools/specs.mjs` into a thin CLI parsing and output mapping boundary, extracting command orchestration into application modules.
- **D3.** Decouple pure decision logic from filesystem I/O in `tools/specs/lifecycle.mjs` and modularize `tools/specs/service.mjs` by cohesive capability, migrating internal callers directly.
- **D4.** Modularize dashboard server routes and refactor frontend features into vertical feature slices (Spec Detail, Changes & Diffs, AI Assistant Chat) containing their components, feature-local hooks, dialogs, and pure view-models, retiring redundant forwarding exports in `use-dashboard-data.ts` as callers migrate.

## Illustrative Architectural Boundaries

> **Note:** The module breakdown below is an illustrative example of cohesive capability and vertical feature boundaries, not a rigid directory layout that must be implemented mechanically. Final file and module placement is chosen during task implementation using the smallest cohesive responsibility boundary required by the code and the applicable guideline.

```text
tools/
├── specs.mjs                     # Thin Commander CLI entrypoint
├── docs.mjs                      # Thin docs CLI entrypoint
├── specs/
│   ├── commands/                 # Command orchestration handlers (e.g. start, approve, finalize)
│   ├── lifecycle/                # Pure lifecycle capabilities (transitions, recovery, batch, stage)
│   ├── store/                    # Change and task filesystem persistence
│   ├── context.mjs               # Task context packet construction
│   ├── fingerprint.mjs           # Pure fingerprint calculations
│   ├── indexes.mjs               # Specification index generation
│   ├── follow-ups.mjs            # Follow-up ledger persistence
│   └── gates.mjs                 # Reusable workflow gate evaluations (shared in-process with server)
├── lib/                          # Shared low-level adapters (git, fs, github, errors, yaml)
├── dashboard/
│   ├── server/
│   │   ├── routes/               # Thin HTTP/SSE route handlers
│   │   ├── actions.mjs           # Non-blocking action execution reusing shared spec operations
│   │   ├── operations.mjs        # Long-running operation runtime with cancellation
│   │   └── data.mjs              # Data projection for dashboard views
│   └── src/
│       ├── components/
│       │   ├── spec-detail/      # Vertical slice: Spec detail component, section projection, feature-local queries
│       │   ├── changes-panel/    # Vertical slice: Changes component, diff hydrator, feature-local queries, grouping
│       │   ├── ai-chat/          # Vertical slice: AI chat, visual viewport, assistant runtime, projections
│       │   └── ui/               # Reusable UI primitives and Radix wrappers
│       ├── hooks/                # Global/shared hooks (use-batch-queries, use-dashboard-events)
│       └── lib/                  # Shared cross-feature utilities (types, utils)
└── tests/                        # Layered test suites maintained at responsibility boundaries
```

## Areas

- `areas/specs-core-and-lifecycle.md` — shared application operations, gate evaluations, and pure lifecycle logic.
- `areas/cli-architecture.md` — thin CLI boundary, command dispatching, and output/exit contracts.
- `areas/dashboard-server-runtime.md` — server route modularization, non-blocking execution, and direct operation reuse.
- `areas/dashboard-frontend-features.md` — vertical feature slices (Spec Detail, Changes, AI Chat) with feature-local hooks, dialogs, and projections.

## Change-wide Acceptance Criteria

1. Dashboard server actions (`tools/dashboard/server/actions.mjs`) no longer execute blocking `execFileSync` calls or spawn CLI subprocesses for gate evaluations, calling shared application operations directly in-process. `automated: npm --prefix tools/dashboard test`
2. `tools/specs.mjs` serves strictly as a CLI entrypoint, delegating orchestration to reusable command modules and managing stdout/stderr/exit codes at the boundary. `automated: node --test tools/tests/*.test.mjs`
3. Pure lifecycle decision logic (transitions, recovery postconditions, stage derivation, fingerprinting) is separated from file/Git side effects and covered by unit tests. `automated: node --test tools/tests/*.test.mjs`
4. Dashboard server HTTP and SSE routes are organized into thin route modules with request validation and proper cleanup. `automated: npm --prefix tools/dashboard test`
5. Specification Detail feature is refactored into a vertical slice with feature-local queries, document/section projections, and overview composition, migrating spec callers from `use-dashboard-data.ts`. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`
6. Changes & PR Diffs feature is refactored into a vertical slice with progressive diff hydration, feature-local queries, and feature-local grouping logic, migrating changes callers from `use-dashboard-data.ts`. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`
7. AI Assistant Chat feature is refactored into a vertical slice with decomposed assistant runtime (`nevo-assistant-runtime.ts`), feature-local projections/helpers, feature-local queries, and viewport tracking, retiring redundant exports from `use-dashboard-data.ts`. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`
8. All existing functionality, CLI commands, HTTP routes, SSE events, and dashboard UI behavior remain 100% backward compatible without regressions. `automated: npm test && npm --prefix tools/dashboard test && node tools/specs.mjs validate && node tools/docs.mjs validate`
9. All guideline checklist items for the modules and boundaries modified by this specification are satisfied; pre-existing issues outside this change's scope are recorded in `follow-ups.yaml`. `inspection: checklist audit`

## Verification Strategy

- **Node Automated Tests:** Full test suite execution with `npm test`.
- **Dashboard Automated Tests:** Dashboard test suite execution with `npm --prefix tools/dashboard test`.
- **TypeScript Build Validation:** Frontend type check and production bundling with `npm --prefix tools/dashboard run build`.
- **Repository Integrity Validation:** Specification and documentation verification (`node tools/specs.mjs validate`, `node tools/docs.mjs validate`, `node tools/specs.mjs check`).
- **Guidelines Audit:** Focused checklist verification against `node-tooling-guidelines.md` and `react-component-guidelines.md` for modules modified in this specification.
