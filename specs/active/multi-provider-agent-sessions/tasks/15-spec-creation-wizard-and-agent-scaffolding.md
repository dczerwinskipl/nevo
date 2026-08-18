---
id: multi-provider-agent-sessions.spec-creation-wizard-and-agent-scaffolding
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/assistant-ui-frontend.md
    - specs/active/multi-provider-agent-sessions/areas/session-binding-and-context.md
    - specs/active/multi-provider-agent-sessions/tasks/09-dashboard-session-ux-and-spec-binding.md
    - specs/active/multi-provider-agent-sessions/tasks/13-agent-execution-modes-and-permissions.md
    - tools/specs/service.mjs
    - tools/dashboard/server/index.mjs
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/spec-create-modal.tsx
allowed_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
  - tools/dashboard/tests/**
  - tools/tests/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D6]
  constraints: [C1, C2, C3, C6, C7, C10]
---

# Task: Specification creation wizard and agent session scaffolding

## Goal

Provide a canonical, atomic, and serialized specification-creation operation shared across CLI and dashboard tooling, surfaced via a streamlined "+ Nowa specyfikacja" action in the NEvo Dashboard sidebar. Allow users to scaffold a new specification skeleton with minimal metadata (slug, title, type/class, goal) through a dedicated modal/wizard under strict atomic rollback semantics, and optionally initiate an immediate AI planning/refinement agent session bound to the new specification with capability-driven provider and execution mode selection (`ask`, `edit`, `agent`).

## Requirements

1. **Canonical specification creation operation (`tools/specs/**`):**
   - Extract/implement a single canonical specification creation function (e.g. `createSpecification` in `tools/specs/service.mjs` or `tools/specs/scaffolding.mjs`), reusable across tooling and the dashboard server without divergent scaffolding rules.
   - The route `POST /api/specs` in `tools/dashboard/server/index.mjs` must remain a thin transport layer forwarding to this canonical operation.
   - The canonical operation owns:
     - **Canonical slug validation:** Validates that the input slug conforms to the repository's canonical slug grammar `^[a-z0-9][a-z0-9._-]*$` (must begin with an alphanumeric character, followed by alphanumeric characters, dots, underscores, or hyphens; lowercase, trimmed). Rejects whitespace, uppercase letters, path traversal (`..`), or illegal characters with domain-neutral `SpecValidationError` (`code: 'SPEC_VALIDATION_ERROR'`).
     - **Active & archive collision detection:** Checks for collision against any existing specification in both `specs/active/` and `specs/archive/`. Rejects duplicates with domain-neutral `SpecConflictError` (`code: 'SPEC_CONFLICT'`).
     - **Spec ID generation:** Generates an immutable canonical UUID `spec_id: crypto.randomUUID()`.
     - **`change.yaml` scaffolding:** Generates the standard specification manifest containing `id: <slug>`, `title: <title>`, `type: <type>` (`standard` | `architectural` | `small` | `exploratory`), `status: draft`, `priority: 10`, `created: YYYY-MM-DD`, `spec_id: <uuid>`, and empty `tasks: []`.
     - **`overview.md` scaffolding:** Generates the standard markdown document structure containing `# <title>`, `## Context`, `## Goal`, `## Non-goals`, `## Constraints`, `## Affected Areas`, `## Implementation Decomposition`, and `## Acceptance Criteria & Verification`.
     - **Index synchronization:** Rebuilds and writes generated indexes (`specs/active.generated.md`, `specs/archive.generated.md`, `specs/index.generated.json`) by reusing the existing canonical service functions `buildSpecsIndexes(...)` and `writeSpecsIndexes(...)` (or an extracted convenience wrapper `refreshSpecsIndexes(...)`), ensuring the newly created specification is immediately discoverable across all tooling (`tools/specs.mjs list`, `validate`, `check`, dashboard data loader) without creating a second indexing implementation.
   - Returns `{ ok: true, slug, specId, change }`.

2. **Serialized repository mutation & atomic rollback semantics:**
   - **Atomicity Invariant:** *Either the complete specification skeleton is committed and discoverable, or creation fails without exposing a partial specification or stale index entries.*
   - **Serialized creation lock:** Because generated specification indexes are shared global files, all specification creations are serialized under a single process-local/repository-local creation mutex/lock. The lock covers all specification creation requests (not only requests using the same slug) to prevent concurrent writes from creating stale snapshots or lost index entries.
   - **Mutation sequence:**
     1. Acquire the creation lock.
     2. Validate slug and metadata.
     3. Check active and archived change collisions.
     4. Create directory `specs/active/<slug>/` and write `change.yaml` and `overview.md`.
     5. Rebuild and write indexes using `buildSpecsIndexes(...)` and `writeSpecsIndexes(...)`.
     6. Release lock and return success.
   - **Atomic rollback & recovery error handling:**
     - If any failure occurs during file creation (`change.yaml`, `overview.md`) or index writing (including partial index-write failures where one generated file was updated before another failed):
       1. Capture the original creation/index failure.
       2. Attempt removal of the newly created directory `specs/active/<slug>/` and all its contents.
       3. Attempt rebuilding and rewriting generated indexes from the filesystem using `buildSpecsIndexes(...)` and `writeSpecsIndexes(...)` so generated files match disk state with zero orphaned or ghost references.
       4. Collect any recovery failures during rollback steps.
       5. If rollback succeeds completely, release lock and rethrow the original failure.
       6. If one or more recovery operations fail, throw a `SpecRollbackError` (`code: 'SPEC_ROLLBACK_FAILED'`) preserving the original failure as `cause`, listing `failedSteps` (e.g. `['cleanup_directory', 'rebuild_indexes']`) and `recoveryErrors`.
   - Existing specifications must NEVER be overwritten under any circumstances.

3. **Domain-neutral specification errors:**
   - `tools/specs/**` must remain decoupled from AI runtime contracts and HTTP transport concepts.
   - It throws neutral domain errors:
     - `SpecValidationError` (`code: 'SPEC_VALIDATION_ERROR'`) for invalid slug, title, or type.
     - `SpecConflictError` (`code: 'SPEC_CONFLICT'`) when a slug already exists in active or archive specs.
     - `SpecRollbackError` (`code: 'SPEC_ROLLBACK_FAILED'`) when specification rollback fails after a creation error.
   - The dashboard HTTP handler `POST /api/specs` maps these errors to HTTP responses:
     - `SpecValidationError` -> HTTP 400 Bad Request
     - `SpecConflictError` -> HTTP 409 Conflict
     - `SpecRollbackError` -> HTTP 500 Internal Server Error (with `failedSteps` and `code: 'SPEC_ROLLBACK_FAILED'`)
     - Unexpected server/IO errors -> HTTP 500 Internal Server Error

4. **Two-phase spec + AI flow:**
   - Specification creation and AI-session creation are distinct, durable operations.
   - **Phase 1:** Create specification skeleton via `POST /api/specs`.
   - **Phase 2 (Optional):** If AI planning is selected, create and initialize the planning agent session via generic `POST /api/agent-sessions` (`{ provider, specId, mode, title: "Planowanie specyfikacji" }`) and kick off the initial turn (`POST /api/agent-sessions/:provider/:providerSessionId/turns`).
   - **Failure handling & recovery:**
     - If Phase 1 (spec creation) fails: the wizard halts, does not call AI session endpoints, and displays the error message.
     - If Phase 1 succeeds but Phase 2 (AI session creation or kickoff) fails:
       - The created specification is preserved on disk (never deleted or rolled back).
       - The UI displays a clear notification banner: `"Specyfikacja została utworzona pomyślnie, ale uruchomienie sesji AI nie powiodło się: <error>"`.
       - The user is presented with two explicit options:
         1. **"Otwórz specyfikację"**: navigate to the newly created specification without AI.
         2. **"Spróbuj ponownie"**: retry only the AI session creation (`POST /api/agent-sessions` with the existing `specId`). Retrying must NEVER call `POST /api/specs` again.

5. **Deterministic, capability-driven planning provider and mode selection:**
   - Uses the existing provider capability API (`useAiProviders()` / `GET /api/ai/providers`).
   - **Provider availability & ordering:** Unavailable providers (`enabled === false` or probe failure) are disabled and cannot be selected; the `mock` demonstration provider is placed at the end of the provider list.
   - **Mode selection:**
     - Mode options are populated dynamically from the selected provider's `supportedModes`.
     - Initial mode selection defaults to `'agent'` (autonomous mode) if supported by the provider; otherwise falls back to the provider's declared `defaultMode` or `'edit'`.
     - Changing the selected provider dynamically re-evaluates and resets the selected mode according to the newly chosen provider's capabilities.
   - **Prompt input:**
     - Rendered as a multi-line, resizable `<textarea>`.
     - Pre-populated with an editable contextual template: `Pomóż mi zaplanować i przygotować pełną specyfikację dla zadania: <title>.\n\nCel:\n<goal>`.
     - User can freely modify, expand, or clear the prompt.
   - **Generic session API:** Uses the standard, provider-neutral agent-session API without wizard-specific provider branching or proprietary hooks.

6. **Dashboard UI integration (`AppSidebar` & `SpecCreateModal`):**
   - Add a primary "+ Nowa specyfikacja" action button in `tools/dashboard/src/components/app-sidebar.tsx` in the header section, styled consistently with the "Nowa sesja" action.
   - Implement `tools/dashboard/src/components/spec-create-modal.tsx`:
     - **Step 1 / Core specification data:**
       - `Tytuł` (Title): text input; auto-generates recommended `slug` conforming to `^[a-z0-9][a-z0-9._-]*$` as the user types (with manual override capability).
       - `Identyfikator / Slug`: validated text input with real-time feedback.
       - `Typ specyfikacji`: selector for `Standard (T)`, `Architektoniczny (A)`, `Mały (S)`, `Eksploracyjny (E)`.
       - `Cel / Opis (Goal)`: textarea describing the change goal.
     - **Step 2 / Optional AI Planning Session:**
       - Toggle: "Rozpocznij sesję AI do zaplanowania specyfikacji".
       - Provider selector with availability badges (mock provider at the end).
       - Execution mode selector (`agent` [Auto - Domyślny], `edit` [Domyślny/Standard], `ask` [Plan]) populated from `supportedModes`.
       - Initial prompt textarea.
   - Wire `SpecCreateModal` into `App.tsx` and add `useCreateSpecification` hook in `tools/dashboard/src/hooks/use-dashboard-data.ts`.

### Verification criteria

1. **Canonical scaffolding helper:** `createSpecification` correctly scaffolds `change.yaml`, `overview.md`, generates canonical UUID `spec_id`, and triggers index synchronization using `buildSpecsIndexes(...)` and `writeSpecsIndexes(...)`.
2. **Slug validation:** Rejects invalid slugs (spaces, uppercase letters, illegal characters, path traversal) with domain-neutral `SpecValidationError`.
3. **Collision rejection:** Active and archived duplicate slugs are rejected with domain-neutral `SpecConflictError` without modifying existing specifications.
4. **Concurrent same-slug creation:** Concurrent creation requests for the same slug result in exactly one successful creation and HTTP 409 Conflict for the competing request.
5. **Concurrent different-slug creation:** Concurrent creation requests for distinct slugs serialize safely without race conditions, creating both specifications and updating generated indexes to contain both without lost updates.
6. **Partial index-write failure & clean rollback:** A simulated failure during index writing triggers complete directory removal and subsequent index rebuilding/rewriting, leaving generated indexes on disk exactly matching active/archived specs with zero ghost references.
7. **Rollback recovery failure surfacing:** If directory removal or index rebuilding fails during rollback, `SpecRollbackError` is thrown with `code: 'SPEC_ROLLBACK_FAILED'`, listing `failedSteps`, recovery errors, and preserving the original cause.
8. **Immediate discoverability:** A created specification is immediately discoverable via `listChanges`, `tools/specs.mjs list`, and dashboard API.
9. **Thin dashboard endpoint:** `POST /api/specs` validates input, delegates to the canonical helper, and returns 201 Created with `{ ok: true, slug, specId, change }`.
10. **Wizard without AI:** Creates specification skeleton, does not call AI session APIs, and navigates to the new specification.
11. **Two-phase wizard with AI:** Creates specification skeleton first, then creates AI session bound to `specId` with chosen mode and sends the initial prompt.
12. **AI failure resilience:** If AI session creation fails after spec creation, the spec is preserved, UI displays error banner, and user can either view spec or retry AI session without re-calling `POST /api/specs`.
13. **Capability-driven mode selection:** Unavailable providers cannot be chosen, modes are filtered by `supportedModes`, defaults to `agent` if available, mock provider is listed last, and changing provider revalidates mode.
14. **Offline-only tests:** All tests run offline with zero external network or process dependencies.

## Verification

```bash
node --test tools/tests/spec-scaffolding.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
node tools/specs.mjs check
```
