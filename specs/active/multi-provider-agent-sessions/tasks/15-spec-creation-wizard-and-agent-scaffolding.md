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
    - tools/dashboard/src/App.tsx
    - tools/dashboard/src/components/app-sidebar.tsx
    - tools/dashboard/src/components/ai-session-create-modal.tsx
    - tools/dashboard/server/index.mjs
allowed_paths:
  - tools/dashboard/src/**
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
  - tools/tests/**
  - tools/specs/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D6]
  constraints: [C1, C2, C3, C6, C7, C10]
---

# Task: Specification creation wizard and agent session scaffolding

## Goal

Provide a streamlined specification creation interface within the NEvo Dashboard sidebar. Allow users to quickly create a new specification skeleton with minimal metadata (slug, title, type/class, goal) through a dedicated modal/wizard, and optionally start an immediate AI planning/refinement agent session bound to the new specification with provider and execution mode selection (`ask`, `edit`, `agent`).

## Requirements

1. **Dashboard backend specification scaffolding API (`POST /api/specs`):**
   - Create route `POST /api/specs` in `tools/dashboard/server/index.mjs` (or actions/specs server handler).
   - Validates request payload:
     - `slug`: kebab-case string (`^[a-z0-9][a-z0-9._-]*$`), checked for collisions against both active and archive changes.
     - `title`: non-empty string trimmed.
     - `type`: specification class (`standard` | `architectural` | `small` | `exploratory`), defaulting to `standard`.
     - `goal`: optional short description or goal statement.
   - Scaffolds a new specification directory under `specs/active/<slug>/`:
     - Generates canonical `spec_id: <uuid>` (via Node's `crypto.randomUUID()`).
     - Generates `change.yaml` with `id`, `title`, `type`, `status: draft`, `priority: 10`, `created: YYYY-MM-DD`, `spec_id: <uuid>`, and empty task list.
     - Generates `overview.md` with title, goal, and acceptance criteria placeholders.
   - Returns `{ ok: true, slug, specId, change }` with HTTP 201.
   - Rejects invalid inputs with 400 and duplicate slugs with 409 (`Specification already exists`).

2. **Sidebar new specification button (`AppSidebar`):**
   - Add a primary "+ Nowa specyfikacja" action button in `tools/dashboard/src/components/app-sidebar.tsx` in the header section.
   - Triggers the specification creation modal/wizard.

3. **Specification creation modal / wizard (`SpecCreateModal`):**
   - Implemented in `tools/dashboard/src/components/spec-create-modal.tsx`.
   - **Step 1 / Core specification data:**
     - `Tytuł` (Title): text input; auto-generates recommended kebab-case `slug` as the user types (with ability to manually adjust).
     - `Identyfikator / Slug`: kebab-case validated text field.
     - `Typ specyfikacji`: selector for `Standard (T)`, `Architektoniczny (A)`, `Mały (S)`, `Eksploracyjny (E)`.
     - `Cel / Opis (Goal)`: textarea describing the change goal.
   - **Step 2 / Optional AI Planning Session:**
     - Toggle/checkbox: "Rozpocznij sesję AI do zaplanowania specyfikacji" (Start AI session to plan specification).
     - When toggled off: creating the spec simply scaffolds the directory and selects the new specification in the dashboard.
     - When toggled on: expands the AI agent configuration:
       - Provider selector (Claude, Antigravity, Mock) using `useAiProviders()` with availability badges.
       - Execution mode selector (`ask` [Plan], `edit` [Domyślny], `agent` [Auto]), defaulting to `ask` or `edit`.
       - Initial prompt (pre-populated with a contextual prompt: `Pomóż mi zaplanować i przygotować pełną specyfikację dla zadania: <title>.\n\nCel:\n<goal>`, editable by user).
   - Handles submission:
     1. Calls `POST /api/specs` to create the specification skeleton.
     2. If AI session was enabled: calls `POST /api/agent-sessions` with `{ provider, specId: newSpec.specId, mode, title: "Planowanie specyfikacji" }` and opens the chat session with the initial prompt.
     3. If AI session was not enabled: navigates to the newly created specification in the main dashboard view.

4. **Integration in `App.tsx` and data hooks:**
   - Add `useCreateSpecification` hook in `tools/dashboard/src/hooks/use-dashboard-data.ts`.
   - Wire `SpecCreateModal` state in `App.tsx` so users can open the modal from sidebar, successfully create specs, and transition smoothly either to the spec detail view or the live chat page.

## Verification

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
