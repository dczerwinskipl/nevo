## D1: Test suite directory structure and recursive execution

- **Question:** How should the test files in `tools/tests/` and `tools/dashboard/tests/` be organized, and how should test discovery be configured?
- **Options considered:** Keep flat folders and rename files | organize into domain-oriented subdirectories (`cli/`, `specs/`, `lib/`, `ai/`, `docs/`, `e2e/` and `server/`, `ui/`, `view-models/`, `integration/`) with recursive test runner configuration (`**/*.test.mjs`)
- **Decision:** Organize tests into domain subdirectories and update `package.json` and `tools/dashboard/package.json` test scripts with recursive globs.
- **Consequences:** Tests become navigable and aligned with architectural boundaries; developers and CI can execute focused subsuites (e.g. `node --test tools/tests/specs/**/*.test.mjs`); relative helper imports are safely adjusted.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/tests/**`, `tools/dashboard/tests/**`, `package.json`, `tools/dashboard/package.json`

## D2: Specs CLI and engine decomposition strategy

- **Question:** How should the 1855-line `tools/specs.mjs`, 1745-line `tools/specs/lifecycle.mjs`, and 1042-line `tools/specs/service.mjs` be refactored?
- **Options considered:** Mechanical file splitting by size without boundary changes | domain-driven modularization extracting thin CLI dispatchers, dedicated command handlers (`specs/commands/*`), cohesive lifecycle modules (`lifecycle/*`), and domain stores/indexes
- **Decision:** Adopt domain-driven modularization following `node-tooling-guidelines.md`. `tools/specs.mjs` becomes a thin CLI parser (< 300 LOC); handlers move to `tools/specs/commands/*`; `lifecycle.mjs` splits into `transitions`, `recovery`, `batch`, `provenance`, and `stage`; `service.mjs` splits into `store/change-store.mjs`, `fingerprint.mjs`, `indexes.mjs`, `context.mjs`, and `follow-ups.mjs`.
- **Consequences:** Eliminates oversized catch-all modules, clarifies module ownership, enables direct reuse of spec operations without running child CLI processes, and makes each domain module unit-testable.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/specs.mjs`, `tools/specs/**`

## D3: AI subsystem isolation and streaming architecture

- **Question:** How should provider adapters (`antigravity`, `codex`, `claude`) and turn runtime in `tools/ai/` be structured to adhere to Node guidelines?
- **Options considered:** Keep adapter monoliths and wrap in interfaces | decouple pure wire protocol translation from child process execution, state machines, and streaming handlers
- **Decision:** Decouple protocol encoding/decoding into pure helper modules, isolate child process execution with explicit `AbortSignal` cancellation, and encapsulate turn state transitions in `turn-runtime.mjs`.
- **Consequences:** Protocol parsing is testable without spawning real/mock processes, process termination and cancellation are deterministic, and unhandled child-process exceptions are cleanly prevented.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/ai/**`

## D4: Dashboard backend & frontend architectural layering

- **Question:** How should the dashboard server and React frontend be modularized to meet Node and React guidelines?
- **Options considered:** Minimal refactor keeping `use-dashboard-data.ts` and composite components intact | modularize server routes (`server/routes/*`), break down `use-dashboard-data.ts` into domain hooks (`hooks/use-specs.ts`, `hooks/use-changes.ts`, `hooks/use-operations.ts`), and decompose frontend view monoliths (`spec-detail.tsx`, `changes-panel.tsx`, `ai-chat.tsx`, `nevo-assistant-runtime.ts`) into feature-local component trees and pure view-model projections
- **Decision:** Implement full architectural decomposition for both backend routes and frontend components/hooks according to `node-tooling-guidelines.md` and `react-component-guidelines.md`.
- **Consequences:** Server request paths avoid blocking calls; frontend view-model projections stay pure and testable outside JSX; UI components become small, focused, and maintainable without mega-files or global hook god-objects.
- **Date:** 2026-08-25
- **Affected artifacts:** `tools/dashboard/server/**`, `tools/dashboard/src/**`
