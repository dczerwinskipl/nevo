---
id: development.dashboard-frontend-architecture
type: development
title: Dashboard frontend architecture
status: current
read_when:
  - developing, restructuring, or creating frontend components in tools/dashboard/ui
  - frontend architecture
  - dashboard architecture
  - feature boundaries and domain areas
  - shared ui
  - component ownership
  - storybook story colocation
  - folder structure and import boundaries
summary: >
  Comprehensive frontend architecture for the NEvo dashboard: layer responsibilities
  (app -> routes -> features -> shared), component taxonomy, domain areas, public API and
  import boundaries, resolution of components/ui vs shared/ui, state management and data
  fetching, Storybook and testing colocation, component placement decision matrix, and
  migration strategy.
tags:
  - frontend
  - architecture
  - react
  - dashboard
  - features
  - shared-ui
  - storybook
related:
  - development.react-component-guidelines
  - development.storybook
  - development.ui-ux-guidelines
  - development.nevo-ai-ux-guidelines
---

# Dashboard Frontend Architecture

## 1. Executive Summary & Purpose

The NEvo dashboard (`tools/dashboard/ui`) is a developer console and AI orchestration interface supporting spec-driven development, AI session monitoring, pull request inspection, and background operations.

### Technical Stack

- **React 19 & TypeScript:** React 19.2.8 and TypeScript 7.0.2 with strict typing, function components, hooks, and modern concurrent primitives.
- **TanStack Router:** TanStack Router 1.170.32, type-safe, file-system routing generated via `@tanstack/router-generator`.
- **TanStack Query:** TanStack Query 5.101.4, asynchronous server state caching, background polling, and cache invalidation.
- **Tailwind CSS v4:** Tailwind CSS 4.3.3, direct-value semantic design tokens declared in `@theme static`, compiled via `@tailwindcss/vite` on Vite 8.2.1.
- **Radix UI:** Headless, accessible behavior primitives for dialogs, sheets, menus, tooltips, and portals.
- **Storybook 10.6 & Vitest 4.1:** Storybook 10.6.0 with Vitest 4.1.11. Component stories are co-located with implementation; browser-backed interaction and visual assertion tests run via `@storybook/addon-vitest` and `@vitest/browser-playwright` in headless Chromium (Playwright 1.62.1). Note that a general automated axe-core accessibility scanner suite is not installed; tests focus on user interaction, state transitions, and live computed token/contrast assertions.

### Core Architectural Philosophy

1. **Vertical Domain Slices:** Features own their presentation, domain models, view-model projections, queries, and stories.
2. **Domain-Agnostic Shared Layer:** Shared UI primitives have zero knowledge of business entities (sessions, specs, PRs).
3. **Explicit Public Boundaries:** Module boundaries are strictly enforced; deep cross-feature imports and generic barrel files are banned.
4. **Token-Driven Presentation:** Components express styling through semantic design tokens rather than arbitrary raw hex or ad-hoc utility mixes.

---

## 2. Layer Responsibilities and Dependency Rules

The dashboard frontend is organized into four production hierarchical layers, with design system foundations and Storybook acting as external documentation and testing consumers:

$$\text{App} \longrightarrow \text{Routes} \longrightarrow \text{Features} \longrightarrow \text{Shared}$$

```text
┌────────────────────────────────────────────────────────┐
│ App Composition & Providers (ui/app/, ui/App.tsx)      │
└───────────────────────────┬────────────────────────────┘
                            │ imports
                            ▼
┌────────────────────────────────────────────────────────┐
│ Route Entry Points (ui/routes/)                        │
└───────────────────────────┬────────────────────────────┘
                            │ imports
                            ▼
┌────────────────────────────────────────────────────────┐
│ Feature Verticals (ui/features/<domain>/)              │
│ - agent-sessions  - specifications                     │
│ - pull-requests   - operations                         │
└───────────────────────────┬────────────────────────────┘
                            │ imports
                            ▼
┌────────────────────────────────────────────────────────┐
│ Shared UI & Utilities (ui/shared/, legacy ui/components)│
└────────────────────────────────────────────────────────┘

Testing & Documentation Consumers (Non-Production):
ui/foundations/ (design system catalog stories)
.storybook/ (Storybook configuration & test-utils)
```

### Layer Definitions

| Layer | Directory | Responsibilities | Permitted Imports |
|---|---|---|---|
| **App** | `ui/app/`, `ui/App.tsx`, `ui/main.tsx` | Global bootstrap, root providers (`QueryClientProvider`, router context, theme shell, global error boundaries), root layout frame. | `routes`, `features`, `shared` |
| **Routes** | `ui/routes/` | File-system routing entry points. Thin orchestrators extracting URL params and route search state, passing them to feature views. | `features`, `shared` |
| **Features** | `ui/features/<domain>/` | Vertical slices owning domain workflows, views, container components, local UI state, queries, mutations, projections, and co-located stories. | `shared`, own feature internals |
| **Shared** | `ui/shared/`, `ui/components/ui/` | Reusable, domain-independent UI primitives (`Button`, `Dialog`, `StatusLabel`), markdown renderers, token contracts (`status-tone.ts`), and utility helpers (`cn`). | External libraries (Radix, Lucide) |
| **Foundations & Testing** *(Consumers)* | `ui/foundations/`, `.storybook/`, `ui/index.css` | Catalog stories, typography inventories, color palettes, and browser test infrastructure. **Consumer layer only; not imported by production code.** | `shared`, `index.css`, `@storybook-test-utils` |

### Dependency Rules

- **Downward-Only Flow:** Upper production layers may import from lower layers (`App -> Routes -> Features -> Shared`). Lower layers must **never** import from upper layers.
- **Shared Layer Isolation:** Modules under `ui/shared/` and `ui/components/` must never import from `features/`, `routes/`, or `app/`.
- **Horizontal Feature Isolation:** Features must never import from sibling features directly. Cross-domain workflows are coordinated at the route/page layer or through shared API client abstractions.
- **Foundations & Storybook Consumer Isolation:** `ui/foundations/` and `.storybook/` exist purely for testing and documentation. Production features, routes, and shared components must **never** import from `ui/foundations/` or `.storybook/`.

---

## 3. Component Taxonomy

To ensure clarity in component design and Storybook documentation, every component is classified into one of four taxonomy tiers:

```text
┌──────────────────────────────────────────────────────────────────┐
│ Component Taxonomy                                               │
├───────────────────────────────┬──────────────────────────────────┤
│ 1. Primitive Component        │ Button, Badge, Card, Dialog      │
│ 2. Shared Composition         │ MarkdownContent, ConfirmDialog   │
│ 3. Feature Component          │ StatusBoard, ChatSurface, StepRow│
│ 4. Application Component      │ AppLayout, GlobalNav, RootShell  │
└───────────────────────────────┴──────────────────────────────────┘
```

### 1. Primitive Components (`Shared/UI/*`)
- **Location:** `tools/dashboard/ui/shared/ui/` (or legacy `tools/dashboard/ui/components/ui/`).
- **Characteristics:** Highly reusable, domain-free, atomic UI elements. Wrapped around Radix primitives or pure HTML elements. Styled exclusively using semantic tokens and `cva()`.
- **Props:** Standard HTML attributes, `children`, semantic `tone` or `variant` props, and optional `className` merged via `cn()`.
- **Domain Knowledge:** **Strictly zero.** They do not know about sessions, tasks, specifications, or PR statuses.
- **Storybook Title:** `Shared/UI/<ComponentName>` (e.g. `Shared/UI/Button`, `Shared/UI/StatusCard`).

### 2. Shared Composition Components (`Shared/*`)
- **Location:** `tools/dashboard/ui/shared/<topic>/` (e.g. `shared/markdown/markdown-content.tsx`).
- **Characteristics:** Composite presentation components combining multiple primitives and utilities for a generic capability without coupling to a specific business entity.
- **Storybook Title:** `Shared/<Topic>/<ComponentName>`.

### 3. Feature Components (`Features/*`)
- **Location:** `tools/dashboard/ui/features/<domain>/`.
- **Characteristics:** Domain-specific components implementing business workflows, dashboards, inspectors, dialogs, and timelines.
- **Data Handling:** Consume feature queries, mutations, route params, or domain models (`CanonicalTurnV2`, `SpecificationDetail`, `AvailablePullRequest`).
- **Storybook Title:** `Features/<Domain>/<ComponentName>` (e.g. `Features/Specifications/Status Board`, `Features/Agent Sessions/Chat Surface`).

### 4. Application Components
- **Location:** `tools/dashboard/ui/app/` or `tools/dashboard/ui/routes/`.
- **Characteristics:** Top-level layout shells, navigation rails, and environment providers.

---

## 4. Domain Areas

The dashboard is structured around four primary domain areas under `tools/dashboard/ui/features/`:

```text
tools/dashboard/ui/features/
├── agent-sessions/    # AI agent chat, turn execution, Work V2 timeline
├── specifications/    # Spec console, status board, tasks, actions
├── pull-requests/     # PR summary cards, diff inspection, file changes
└── operations/        # Long-running background operations & progress
```

### 1. Agent Sessions (`features/agent-sessions`)
- **Responsibilities:** AI session chat surface, message streams, reasoning panels, turn execution, Work V2 three-level progressive disclosure (Level 1 indicator, Level 2 timeline, Level 3 details sheet), tool call cards, interaction prompts, provider configurations (Claude, Antigravity, Mock), SSE event streaming, runtime reducers, and transcript caching.
- **Key Projections:** `activity-model-v2.ts`, `timeline-projection-v2.ts`, `turn-status-tone-v2.ts`.

### 2. Specifications (`features/specifications`)
- **Responsibilities:** Specification console, status board (workflow lanes: `new`, `design`, `ready`, `implementation`, `review`, `done`), task dialogs, metadata editors, spec action dispatchers, document and directory section viewers, and spec creation workflows.
- **Key Projections:** `detail/lane-presentation.ts`, `status.ts` (`specStatusTone`).

### 3. Pull Requests (`features/pull-requests`)
- **Responsibilities:** Pull request summary cards, detail view, file change diffs, diff statistics (`diff-addition`, `diff-deletion`), review state cards, and PR query hooks.
- **Key Projections:** `changes/status.ts` (`fileStatusTone`), `changes/grouping.ts`.

### 4. Operations (`features/operations`)
- **Responsibilities:** Background long-running operations (spec creation, branch creation, migrations), modal progress dialogs (`OperationModal`), step progress rows (`OperationStepRow`), snapshot queries, and terminal state waiting coordination.
- **Key Projections:** `operation-snapshot.ts`, `wait-for-operation-terminal.ts`.

### Feature Boundary Rules

- Features cannot import directly from sibling feature directories.
- If two features need to exchange data, communication occurs via route parameters (e.g., navigating to `/specs/claude/my-spec/sessions/antigravity/sess-123`) or shared backend API endpoints.
- Cross-domain UI orchestration belongs in `ui/routes/` or `ui/app/`, not inside individual feature verticals.

### Cross-Feature Deep Imports (Acknowledged Migration Debt)

The current dashboard implementation contains several historical cross-feature deep imports that predate this architecture contract. These are formally recognized as migration debt to be eliminated in a dedicated architectural change:

1. **`features/specifications` deeply imports from:**
   - `@/features/agent-sessions/types`
   - `@/features/agent-sessions/agent-session-list`
   - `@/features/agent-sessions/queries`
   - `@/features/agent-sessions/initial-dispatch`
   - `@/features/agent-sessions/create-agent-session-helpers`
   - `@/features/agent-sessions/provider-config`
   - `@/features/agent-sessions/create-agent-session-dialog`
   - `@/features/operations/wait-for-operation-terminal`
   - `@/features/operations/operation-modal`
   - `@/features/pull-requests/queries`
   - `@/features/pull-requests/panel/pull-requests-panel`
2. **`features/agent-sessions` deeply imports from:**
   - `@/features/specifications/types`
   - `@/features/specifications/tasks/task-dialog`
   - `@/features/specifications/queries`
3. **`features/pull-requests` deeply imports from:**
   - `@/features/specifications/types`

**Guardrail:** This inventory is frozen. No new cross-feature deep imports may be added. Existing imports will be resolved via the deferred migration plan (Section 11).

---

## 5. Public API and Import Boundaries

Clear import paths maintain codebase maintainability, avoid circular dependencies, and enable robust bundler optimizations.

### 1. Coherent Public API Guidance

- **Explicit Named Exports:** Modules must export symbols explicitly by name (e.g. `export function StatusBoard(...)`, `export const specStatusTone = ...`).
- **No Wildcard Re-Exports:** Catch-all barrel files using `export * from '...'` are strictly prohibited. Wildcard re-exports obscure symbol provenance, hinder tree-shaking, and easily introduce circular dependency cycles.
- **Entry Points:** When a feature or shared module establishes an `index.ts`, it must explicitly enumerate its public exports by name.

### 2. Relative vs. Root-Relative Imports

- **Within the same feature or directory:** Always use **relative imports**:
  ```typescript
  // CORRECT: Relative within same feature
  import { useSpecWorkflowActions } from '../actions/use-spec-workflow-actions';
  import { specStatusTone } from '../status';
  ```
- **Cross-boundary imports:** Always use root-relative imports via the `@/` path alias pointing to the public entry point or specific primitive:
  ```typescript
  // CORRECT: Root alias for cross-boundary imports
  import { Button } from '@/components/ui/button';
  import { StatusLabel } from '@/shared/ui/status-label';
  import { StatusTone } from '@/shared/status-tone';
  ```

### 3. Prohibition of New Deep Feature Imports

- Sibling features must never reach into another feature's internal directories:
  ```typescript
  // FORBIDDEN: Deep cross-feature import
  import { reduceSessionEvents } from '@/features/agent-sessions/runtime/agent-event-reducer';
  ```
- Any cross-domain composition must be hoisted to route components in `tools/dashboard/ui/routes/` or shared abstractions.

---

## 6. Resolution of `components/ui` vs `shared/ui`

The dashboard codebase currently contains both `tools/dashboard/ui/components/ui/` and `tools/dashboard/ui/shared/ui/`. This section formally resolves their architectural relationship.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Shared Component Locations                                               │
├──────────────────────────────────┬───────────────────────────────────────┤
│ Target Architecture              │ tools/dashboard/ui/shared/ui/         │
│ Legacy Recognized Exception      │ tools/dashboard/ui/components/ui/     │
└──────────────────────────────────┴───────────────────────────────────────┘
```

### Architectural Contract: `shared/ui` is the Official Home

- `tools/dashboard/ui/shared/ui/` is the permanent, official home for all shared, domain-agnostic UI primitives in the dashboard design system.
- All new primitives must be authored in `tools/dashboard/ui/shared/ui/`.

### The Legacy Exception: `components/ui`

- **Origin:** `tools/dashboard/ui/components/ui/` was created during initial project scaffolding using standard shadcn-ui conventions (`button.tsx`, `dialog.tsx`, `sheet.tsx`, `badge.tsx`, `card.tsx`, `progress.tsx`, `status-card.tsx`).
- **Status:** Maintained as a recognized legacy directory.
- **Tooling Configuration:** The shadcn CLI configuration (`tools/dashboard/components.json`) currently maps `"ui": "@/components/ui"`. This mapping will be updated to point to `@/shared/ui` during the consolidation change.
- **Rationale for Deferring Mass Migration:** Moving all primitive files and updating all import sites across more than 50 files would produce extensive churn unrelated to semantic token migration, risking merge conflicts on in-flight branches.
- **Migration Plan:** A dedicated future architectural change will mechanically move all files from `components/ui/` to `shared/ui/`, update import statements, update `components.json`, and delete `components/ui/`.

---

## 7. State Management and Data Fetching

State is partitioned strictly according to its lifecycle and frequency of update:

```text
┌──────────────────────────────────────────────────────────────────┐
│ State Classification                                             │
├───────────────────────────────┬──────────────────────────────────┤
│ Server State                  │ TanStack Query (queries, caching)│
│ Realtime Streaming State      │ Transports, SSE listeners, events│
│ View-Model Projections        │ Pure deterministic transforms    │
│ Local Interaction State       │ React useState / useReducer      │
└───────────────────────────────┴──────────────────────────────────┘
```

1. **Server State (TanStack Query):** Remote REST resources (specifications list, PR status, provider availability) are fetched and cached via `@tanstack/react-query`.
2. **Realtime & Streaming State:** Long-lived streaming data (AI session turns, terminal operations) is handled via dedicated transports (`agent-session-transport.ts`) and event reducers (`agent-event-reducer.ts`), shielding React components from raw socket/SSE connection mechanics.
3. **View Models and Projections:** High-frequency streaming data and complex backend payloads are transformed into presentation view models using pure functions (e.g. `timeline-projection-v2.ts`, `lane-presentation.ts`). Projections are tested in isolation using pure unit tests.
4. **Local UI State:** Ephemeral interaction states (modal open/close, active tab, hover states, draft inputs) remain local to the component or feature hook via `useState` or `useReducer`.

---

## 8. Storybook and Testing Colocation

Storybook is an executable component catalog and browser-testing platform.

### Story Colocation Invariant

- Every component story file (`*.stories.tsx`) **must be co-located** in the exact same directory as the component it exercises:
  ```text
  tools/dashboard/ui/components/ui/button.tsx
  tools/dashboard/ui/components/ui/button.stories.tsx   <-- Co-located
  ```
- **No Omnibus Stories:** Omnibus story files that bundle tests for multiple unrelated components are prohibited. Each component owns its story file.

### Storybook Naming Hierarchy

Story titles must mirror the component taxonomy:

| Component Type | Story Title Pattern | Concrete Examples |
|---|---|---|
| **Primitives** | `Shared/UI/<Name>` | `Shared/UI/Button`, `Shared/UI/Badge`, `Shared/UI/Card`, `Shared/UI/Dialog`, `Shared/UI/Sheet`, `Shared/UI/StatusCard`, `Shared/UI/Progress`, `Shared/UI/LoadingScreen` |
| **Features** | `Features/<Domain>/<Component>` | `Features/Specifications/Status Board`<br>`Features/Specifications/Specification List`<br>`Features/Pull Requests/Summary Card`<br>`Features/Operations/Step Row`<br>`Features/Agent Sessions/Chat Surface`<br>`Features/Agent Sessions/Agent Session Details` |
| **Foundations** | `Foundations/<Topic>` | `Foundations/Colors`, `Foundations/Typography`, `Foundations/Smoke`, `Foundations/TokenResolver` |

### Test Utilities Isolation

- **Location:** All Storybook testing utilities, color calculation helpers, and DOM interaction helpers reside in `tools/dashboard/.storybook/test-utils/`.
- **Path Alias:** Imported across stories via the `@storybook-test-utils` path alias.
- **Production Isolation:** Test utilities and mock helpers must **never** be placed inside production directories (`components/ui` or `shared/ui`).

---

## 9. Component Placement and Decision Matrix

When creating or modifying a frontend file, consult this decision matrix to determine the appropriate destination:

| Evaluation Question | If YES: Destination | If NO: Next Step |
|---|---|---|
| **1. Is this file a route or URL entry point?** | `tools/dashboard/ui/routes/` | Proceed to question 2 |
| **2. Is this file an application root bootstrap or provider?** | `tools/dashboard/ui/app/` (or `App.tsx`) | Proceed to question 3 |
| **3. Does this component handle domain models, workflows, or data for a specific feature (`agent-sessions`, `specifications`, `pull-requests`, `operations`)?** | `tools/dashboard/ui/features/<domain>/` | Proceed to question 4 |
| **4. Is this component a domain-agnostic UI primitive (button, input, modal, card)?** | `tools/dashboard/ui/shared/ui/` *(target)*<br>*(or legacy `components/ui/`)* | Proceed to question 5 |
| **5. Is this a domain-agnostic helper, markdown renderer, or shared contract?** | `tools/dashboard/ui/shared/<area>/` | Proceed to question 6 |
| **6. Is this a design token, global CSS rule, or design system catalog?** | `tools/dashboard/ui/foundations/` or `ui/index.css` | Re-evaluate component scope |

### Worked Examples

1. **`StatusLabel`:** A generic status badge that takes a semantic `tone` and renders children. It knows nothing about domain models.
   - *Destination:* `tools/dashboard/ui/shared/ui/status-label.tsx`
2. **`StatusBoard`:** Renders the 6 workflow lanes for a specification and handles task stage changes.
   - *Destination:* `tools/dashboard/ui/features/specifications/detail/status-board.tsx`
3. **`specStatusTone`:** Maps specification stages to semantic `StatusTone` values.
   - *Destination:* `tools/dashboard/ui/features/specifications/status.ts`
4. **`OperationModal`:** Displays modal progress for background tasks.
   - *Destination:* `tools/dashboard/ui/features/operations/operation-modal.tsx`
5. **`color-helpers.ts`:** Resolves live computed CSS properties in Storybook tests.
   - *Destination:* `tools/dashboard/.storybook/test-utils/color-helpers.ts`

---

## 10. Directory Structure

### 10.1 Current Verified Directory Layout

The current repository filesystem layout reflects the active codebase during semantic token migration, including legacy directories and acknowledged migration debt:

```text
tools/dashboard/
├── .storybook/                          # Storybook configuration & test utilities (consumer)
│   ├── test-utils/                      # Test infrastructure & browser helpers
│   │   ├── color-helpers.ts             # Canvas/DOM live color resolution
│   │   ├── interaction-helpers.ts       # Storybook interaction utilities
│   │   └── index.ts                     # Test utils public surface
│   ├── main.ts                          # Storybook configuration
│   └── preview.tsx                      # Theme & layout decorators
├── components.json                      # shadcn CLI config (currently aliases "ui" to @/components/ui)
├── ui/
│   ├── main.tsx                         # Client DOM root entry point
│   ├── App.tsx                          # Root provider tree & TanStack Router shell
│   ├── routes/                          # TanStack file-system route tree
│   │   ├── __root.tsx                   # Root layout route with navigation frame
│   │   ├── index.tsx                    # Dashboard home redirect / overview
│   │   ├── specs.tsx                    # Specifications list route
│   │   ├── specs.$specId.tsx            # Specification detail & status board route
│   │   ├── specs.$specId.sessions.$sessionId.tsx # Agent session chat & Work inspector route
│   │   ├── settings.tsx                 # Dashboard settings route
│   │   └── routeTree.gen.ts             # Generated TanStack router manifest
│   ├── features/                        # Domain-driven vertical slices
│   │   ├── agent-sessions/              # AI sessions, chat surface, Work V2 timeline
│   │   ├── specifications/              # Specification console, status board, tasks
│   │   ├── pull-requests/               # Pull request cards, diff views, file changes
│   │   └── operations/                  # Background operation progress & modal
│   ├── shared/                          # Domain-agnostic shared layer
│   │   ├── ui/                          # Target directory for shared primitives
│   │   │   ├── loading-screen.tsx & loading-screen.stories.tsx
│   │   │   └── status-label.tsx
│   │   ├── markdown/                    # Markdown rendering components
│   │   ├── hooks/                       # Shared utility hooks (use-theme.ts, etc.)
│   │   └── status-tone.ts               # Canonical StatusTone contract
│   ├── components/
│   │   └── ui/                          # Legacy primitive directory (shadcn scaffolding)
│   │       ├── badge.tsx & badge.stories.tsx
│   │       ├── button.tsx & button.stories.tsx
│   │       ├── card.tsx & card.stories.tsx
│   │       ├── dialog.tsx & dialog.stories.tsx
│   │       ├── progress.tsx & progress.stories.tsx
│   │       ├── sheet.tsx & sheet.stories.tsx
│   │       └── status-card.tsx & status-card.stories.tsx
│   ├── foundations/                     # Design system catalog stories (consumer)
│   │   ├── colors.stories.tsx
│   │   ├── typography.stories.tsx
│   │   ├── smoke.stories.tsx
│   │   └── token-resolver.stories.tsx
│   ├── index.css                        # Tailwind 4 theme & direct tokens
│   └── index.html                       # Single-page app HTML host
└── vitest.config.ts                     # Vitest unit & Storybook browser runner config
```

### 10.2 Target Convention Directory Layout

The target architectural layout organizes features and shared modules uniformly with explicit public boundaries, co-located tests and stories, and zero legacy directories:

```text
tools/dashboard/ui/
├── app/                                 # Global bootstrap, provider hierarchy, and root frame
│   ├── providers.tsx                    # QueryClient, Theme, and Error boundaries
│   └── root-layout.tsx                  # Persistent top nav, status bar, and shell frame
├── routes/                              # Thin route orchestrators (URL -> Feature Views)
│   └── <route-name>.tsx                 # Parameter extraction, search params, view delegation
├── features/
│   └── <feature-name>/                  # Self-contained vertical feature slice
│       ├── components/                  # Internal feature-specific presentational components
│       ├── hooks/                       # Internal feature-specific interaction & lifecycle hooks
│       ├── queries/                     # Server state fetchers & mutations (TanStack Query)
│       ├── projections/                 # Pure domain-to-presentation view-model transforms
│       ├── types.ts                     # Domain entity & view-model TypeScript contracts
│       ├── <feature-view>.tsx           # Top-level feature screen or container
│       ├── <feature-view>.stories.tsx   # Co-located component story and play tests
│       └── index.ts                     # Explicit named public API (NO export * barrels)
└── shared/
    ├── ui/                              # Unified home for all domain-agnostic UI primitives
    │   └── <component-name>/            # Isolated primitive package
    │       ├── <component-name>.tsx     # Component implementation (CVA recipe, Radix wrapper)
    │       ├── <component-name>.stories.tsx # Co-located component story and interaction test
    │       └── index.ts                 # Optional named export entry point
    ├── markdown/                        # Shared markdown and syntax highlighting renderers
    └── utilities/                       # Pure utility helpers (cn, formatters, tone contracts)
```

---

## 11. Migration Strategy and Guardrails

### Completed in PR #43

1. **Semantic Color Tokens:** Direct-value `@theme static` contract in `index.css`, replacing arbitrary hex and CSS variable references.
2. **Presentational StatusLabel:** Removed domain-status branching and raw status literals from `StatusLabel`; established typed `tone: StatusTone` and feature-owned projections.
3. **Dedicated Diff Tokens:** Added `--color-diff-addition` and `--color-diff-deletion` for git diff statistics, separating diffs from general success/error states.
4. **Story Colocation:** Deleted omnibus story files; co-located individual stories beside each primitive and feature component.
5. **Test Utilities Isolation:** Moved testing and color helpers out of `components/ui` into `.storybook/test-utils/`.
6. **Storybook Title Taxonomy:** Aligned story titles to `Shared/UI/*`, `Features/*`, and `Foundations/*`.

### Deferred to Future Changes

The following architectural transitions are explicitly deferred to follow-up changes:

1. **Feature Public API & Boundary Formalization:** Establish explicit `index.ts` public APIs with named exports for each domain vertical (`agent-sessions`, `specifications`, `pull-requests`, `operations`).
2. **Cross-Feature Deep Import Elimination:** Replace the acknowledged migration debt catalogued in Section 4 by hoisting multi-feature orchestration to route components (`ui/routes/`) or app composition, and extracting shared API clients/contracts.
3. **Lint Boundary Enforcement:** Introduce automated lint checks (e.g. ESLint boundary rules or architectural scanner) to enforce that sibling features do not import each other directly and that wildcard `export *` barrels are rejected.
4. **Consolidation of `components/ui` to `shared/ui`:** Mechanically move all primitives (`badge`, `button`, `card`, `dialog`, `progress`, `sheet`, `status-card`) from `tools/dashboard/ui/components/ui/` to `tools/dashboard/ui/shared/ui/`, update all import sites, and remove `components/ui/`.
5. **Update Component Tooling Config:** Update `tools/dashboard/components.json` so shadcn tooling targets `tools/dashboard/ui/shared/ui/` directly.

### Guardrails for Future Work

- **No New Primitives in `components/ui`:** Any newly introduced shared UI component must be created under `tools/dashboard/ui/shared/ui/`.
- **No Storybook Helpers in Production UI:** Testing utilities must not be placed in `tools/dashboard/ui/`.
- **Frozen Cross-Feature Imports:** Do not add new deep imports between sibling features; hoist cross-feature workflows to routes.
- **Strict Verification Commands:**
  ```bash
  npm --prefix tools/dashboard run format:check
  npm --prefix tools/dashboard test
  npm --prefix tools/dashboard run build
  npm --prefix tools/dashboard run test:storybook
  npm --prefix tools/dashboard run build-storybook
  node tools/docs.mjs validate
  node tools/docs.mjs check
  node tools/specs.mjs validate
  node tools/specs.mjs check
  ```
