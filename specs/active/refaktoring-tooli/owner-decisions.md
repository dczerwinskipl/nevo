## D1: Shared application operations and in-process server execution

- **Question:** How should the dashboard server check gate conditions and execute specification actions without blocking the event loop or duplicating execution paths?
- **Options considered:** Keep spawning `specs.mjs` via `execFileSync` / `spawn` in `server/actions.mjs` | extract reusable application functions in `tools/specs/` for gate evaluation and action checks, consumed directly in-process by both CLI and dashboard server without subprocesses
- **Decision:** Extract shared application operations in `tools/specs/` and call them directly in `tools/dashboard/server/actions.mjs`, eliminating blocking `execFileSync` calls on request paths.
- **Consequences:** Eliminates subprocess spawning for internal operations, prevents server event-loop blocking, and makes gate evaluation directly unit-testable.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/dashboard/server/actions.mjs`, `tools/specs/**`

## D2: Specs CLI boundary separation from command orchestration

- **Question:** How should `tools/specs.mjs` be structured to cleanly separate CLI parsing from application logic?
- **Options considered:** Keep all command implementations inline in `tools/specs.mjs` | extract command orchestration handlers into standalone command modules, keeping `tools/specs.mjs` as a thin CLI argument/option parser and exit-code mapper
- **Decision:** Separate `tools/specs.mjs` into a thin CLI entrypoint delegating to command modules.
- **Consequences:** Deep application modules avoid direct console writes and exit code manipulation; command operations become directly importable and testable without simulating `process.argv`.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/specs.mjs`, `tools/specs/**`

## D3: Specs lifecycle capability decoupling and pure decision logic

- **Question:** How should `tools/specs/lifecycle.mjs` and `tools/specs/service.mjs` be organized to improve cohesion and testability?
- **Options considered:** Keep them as monolithic catch-all files | separate pure decision logic (transitions, recovery inspection, batch selection, stage derivation) from filesystem/Git persistence, organizing modules by cohesive capability
- **Decision:** Separate pure deterministic decision logic from external I/O and split storage/indexing capabilities into cohesive capability modules, migrating internal callers and keeping compatibility re-exports only where real external callers require them.
- **Consequences:** Pure logic can be tested deterministically with fast unit tests without filesystem mocks; redundant forwarding layers can be cleanly eliminated where all internal callers migrate.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/specs/lifecycle/**`, `tools/specs/store/**`, `tools/specs/**`

## D4: Dashboard server modularization and frontend vertical feature slices

- **Question:** How should the dashboard server and React frontend be structured to eliminate monolithic files and technical-layer scattering?
- **Options considered:** Keep monolithic `use-dashboard-data.ts` and horizontal component files | modularize server routes by capability and organize the frontend into vertical feature slices (Spec Detail, Changes & Diffs, AI Assistant Chat) containing their components, feature-local hooks, dialogs, and pure view-models
- **Decision:** Implement vertical feature slices on the frontend and capability routes on the server according to `node-tooling-guidelines.md` and `react-component-guidelines.md`.
- **Consequences:** Each frontend feature owns its complete slice (UI, hooks, dialogs, projections, tests); server routes become thin controllers; feature-specific helpers are no longer scattered in global folders.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/dashboard/server/**`, `tools/dashboard/src/**`
