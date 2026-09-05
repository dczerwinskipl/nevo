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
  - screen composition layer
  - shared ui
  - component ownership
  - storybook story colocation
  - folder structure and import boundaries
summary: >
  Comprehensive frontend architecture for the NEvo dashboard: five-tier layer
  responsibilities (App -> Routes -> Screens -> Features -> Shared), component taxonomy,
  domain verticals, screen-level multi-feature composition, consolidated shared/ui primitives,
  production styling infrastructure in index.css, and verified directory layout.
tags:
  - frontend
  - architecture
  - react
  - dashboard
  - screens
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
- **TanStack Router:** TanStack Router 1.170.32, type-safe file-system routing generated via `@tanstack/router-plugin/vite`.
- **TanStack Query:** TanStack Query 5.101.4, asynchronous server state caching, background polling, and cache invalidation.
- **Tailwind CSS v4:** Tailwind CSS 4.3.3, direct-value semantic design tokens declared in `@theme static`, compiled via `@tailwindcss/vite` on Vite 8.2.1.
- **Radix UI:** Headless, accessible behavior primitives for dialogs, sheets, menus, tooltips, and portals.
- **Storybook 10.6 & Vitest 4.1:** Storybook 10.6.0 with Vitest 4.1.11. Component stories are co-located with implementation; browser-backed interaction and visual assertion tests run via `@storybook/addon-vitest` and `@vitest/browser-playwright` in headless Chromium. Live computed token and contrast assertions run within the test suite.

### Core Architectural Principles

1. **Vertical Domain Slices:** Features own their presentation, domain models, view-model projections, queries, and stories.
2. **Dedicated Screen Composition Layer:** Multi-feature assembly (connecting specifications, agent sessions, pull requests, and operations) occurs in dedicated screens (`ui/screens/`), preventing cross-feature coupling inside feature directories.
3. **Thin Route Adapters:** Routes (`ui/routes/`) are thin file-route wrappers responsible solely for path parameter binding and delegating directly to screens.
4. **Consolidated Domain-Agnostic Shared Layer:** Reusable UI primitives reside in `ui/shared/ui/` with no business logic or domain knowledge.
5. **Canonical Design Tokens with Compatibility Bridge:** Components express styling through semantic design tokens declared in `ui/index.css` via Tailwind CSS 4 `@theme static`, with legacy variables mapped in `:root` for backward compatibility.

---

## 2. Layer Responsibilities and Dependency Rules

The dashboard frontend is organized into five production hierarchical layers, with design system foundations and Storybook acting as catalog and test consumers:

$$\text{App} \longrightarrow \text{Routes} \longrightarrow \text{Screens} \longrightarrow \text{Features} \longrightarrow \text{Shared}$$

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
│ Screen Composition Layer (ui/screens/)                 │
│ - specification-console-layout                         │
│ - specification-detail-screen                          │
│ - agent-session-screen                                 │
│ - active-specifications-screen                         │
│ - archive-specifications-screen                        │
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
│ Shared UI & Utilities (ui/shared/ui/, ui/shared/)      │
│ - badge, button, card, dialog, progress, sheet, etc.   │
│ - markdown, status-tone, lib/utils                     │
└────────────────────────────────────────────────────────┘

Catalog & Testing Consumers:
ui/foundations/ (design system catalog & verification stories)
.storybook/ (Storybook configuration & test-utils)
```

### Layer Definitions

| Layer | Directory | Responsibilities | Permitted Imports |
|---|---|---|---|
| **App** | `ui/app/`, `ui/App.tsx`, `ui/main.tsx` | Global bootstrap, root providers (`QueryClientProvider`, TanStack Router setup), root layout frame. | `routes`, `screens`, `features`, `shared` |
| **Routes** | `ui/routes/` | File-system routing definitions. Thin parameter extractors that read typed params via `Route.useParams()` and delegate directly to corresponding screens. | `screens`, `@tanstack/react-router` |
| **Screens** | `ui/screens/` | Screen-level composition layer. Assembles multiple domain features into unified page views (e.g. connecting spec details, session creation, PR changes, and operations). | `features`, `shared`, `@tanstack/react-router` |
| **Features** | `ui/features/<domain>/` | Vertical slices owning single-domain views, components, local UI state, queries, mutations, projections, and co-located stories. | `shared`, own feature internals |
| **Shared** | `ui/shared/ui/`, `ui/shared/` | Reusable, domain-independent UI primitives (`Button`, `Card`, `Dialog`, `Sheet`, `Badge`, `Progress`, `StatusCard`, `StatusLabel`, `LoadingScreen`), markdown renderers, token contracts (`status-tone.ts`), and utilities (`cn`). | External libraries (Radix, Lucide) |
| **Foundations & Testing** | `ui/foundations/`, `.storybook/` | Catalog stories, typography inventories, color palettes, and browser test infrastructure. Catalog and test verification only; not imported by production UI components. | `shared`, `@storybook-test-utils` |
| **Production Styling** | `ui/index.css` | Production CSS entry point imported by `main.tsx`. Declares Tailwind CSS 4 theme (`@theme static`) and legacy CSS custom property bridge in `:root`. | `@tailwindcss` |

### Dependency Rules

- **Downward-Only Flow:** Upper layers import from lower layers (`App -> Routes -> Screens -> Features -> Shared`). Lower layers never import from upper layers.
- **Shared Layer Isolation:** Modules under `ui/shared/` must never import from `features/`, `screens/`, `routes/`, or `app/`.
- **Feature Layer Focus:** Features focus on their own domain models, components, state, and queries. Multi-feature orchestration belongs in `ui/screens/`.
- **Foundations Consumer Isolation:** `ui/foundations/` and `.storybook/` exist for documentation and testing. Production components never import from `ui/foundations/` or `.storybook/`.

---

## 3. Component Taxonomy

Every frontend component belongs to one of five taxonomy tiers:

```text
┌──────────────────────────────────────────────────────────────────┐
│ Component Taxonomy                                               │
├───────────────────────────────┬──────────────────────────────────┤
│ 1. Primitive Component        │ Button, Badge, Card, Dialog, Sheet│
│ 2. Shared Composition         │ MarkdownContent, StatusLabel     │
│ 3. Feature Component          │ StatusBoard, ChatSurface, StepRow│
│ 4. Screen Component           │ SpecificationDetailScreen, etc.  │
│ 5. Application Component      │ App, router, root frame          │
└───────────────────────────────┴──────────────────────────────────┘
```

### 1. Primitive Components (`Shared/UI/*`)
- **Location:** `tools/dashboard/ui/shared/ui/`.
- **Characteristics:** Atomic, reusable, domain-free UI elements built on Radix primitives or native HTML elements, styled with semantic tokens and `cva()`.
- **Domain Knowledge:** **None.** Primitives do not import or reference business entities (sessions, specs, PRs).
- **Storybook Title:** `Shared/UI/<ComponentName>` (e.g. `Shared/UI/Button`, `Shared/UI/Sheet`, `Shared/UI/StatusCard`).

### 2. Shared Composition Components (`Shared/*`)
- **Location:** `tools/dashboard/ui/shared/<area>/` (e.g. `shared/markdown/markdown-content.tsx`).
- **Characteristics:** Domain-independent composite components providing general functionality (such as markdown rendering with code blocks).
- **Storybook Title:** `Shared/<Area>/<ComponentName>`.

### 3. Feature Components (`Features/*`)
- **Location:** `tools/dashboard/ui/features/<domain>/`.
- **Characteristics:** Domain-specific components implementing business workflows, panels, inspectors, and timelines within a single feature boundary.
- **Data Handling:** Consume feature queries, mutations, or domain models (`CanonicalTurnV2`, `SpecificationSummary`, `AvailablePullRequest`).
- **Storybook Title:** `Features/<Domain>/<ComponentName>` (e.g. `Features/Specifications/Status Board`, `Features/Agent Sessions/Chat Surface`).

### 4. Screen Components (`ui/screens/*`)
- **Location:** `tools/dashboard/ui/screens/`.
- **Characteristics:** Page-level composite views that coordinate multiple features, resolve route-level state, handle fallback redirects, and host dialogs across feature boundaries.

### 5. Application Components
- **Location:** `tools/dashboard/ui/app/` or `tools/dashboard/ui/App.tsx`.
- **Characteristics:** Root bootstrap, TanStack router configuration, and top-level provider hierarchy.

---

## 4. Domain Areas & Screen Composition

The dashboard business logic is structured into four domain areas under `tools/dashboard/ui/features/`:

```text
tools/dashboard/ui/features/
├── agent-sessions/    # AI agent chat, turn execution, Work V2 timeline
├── specifications/    # Spec console, status board, tasks, actions
├── pull-requests/     # PR summary cards, diff inspection, file changes
└── operations/        # Long-running background operations & progress
```

### 1. Agent Sessions (`features/agent-sessions`)
- **Responsibilities:** AI session chat surface, message streams, reasoning panels, turn execution, Work V2 three-level progressive disclosure (Level 1 indicator, Level 2 timeline, Level 3 details sheet), tool call views, interaction prompts, provider configurations, SSE event streaming, runtime reducers, and transcript caching.
- **Key Files:** `agent-session-page.tsx`, `agent-session-header.tsx`, `agent-session-list.tsx`, `work-v2/`, `runtime/`, `transcript/`.

### 2. Specifications (`features/specifications`)
- **Responsibilities:** Specification presentation, status board (workflow lanes: `new`, `design`, `ready`, `implementation`, `review`, `done`), task dialogs, metadata views, spec action dispatchers, document section panels, directory section panels, and spec creation workflows.
- **Key Files:** `detail/specification-detail.tsx`, `detail/status-board.tsx`, `detail/documentation-panel.tsx`, `tasks/task-dialog.tsx`, `actions/spec-actions.tsx`.

### 3. Pull Requests (`features/pull-requests`)
- **Responsibilities:** Pull request summary cards, detail view, file change diffs, diff statistics (`diff-addition`, `diff-deletion`), review state cards, and PR query hooks.
- **Key Files:** `panel/pull-requests-panel.tsx`, `detail/pull-request-detail.tsx`, `changes/file-change.tsx`.

### 4. Operations (`features/operations`)
- **Responsibilities:** Background long-running operations (spec creation, branch creation, migrations), modal progress dialogs (`OperationModal`), step progress rows, snapshot queries, and terminal state waiting coordination.
- **Key Files:** `operation-modal.tsx`, `operation-progress.tsx`, `operation-snapshot.ts`, `wait-for-operation-terminal.ts`.

### Screen Composition Layer (`ui/screens/`)

Rather than having individual features deeply import and orchestrate sibling features, screen-level composition is consolidated in `ui/screens/`:

- **`specification-console-layout.tsx`:** Coordinates the specification sidebar, live connectivity controls, navigation mode (active/archive), search filtering, and the specification creation flow.
- **`specification-detail-screen.tsx`:** Resolves specification by route parameters, handles active/archive fallback redirects, hosts the specification detail view, and orchestrates agent session creation.
- **`agent-session-screen.tsx`:** Resolves the owning specification and session instance, manages back navigation and in-spec session switching, and mounts `AgentSessionPage`.
- **`active-specifications-screen.tsx`:** Connects the active specifications query to the specification list view.
- **`archive-specifications-screen.tsx`:** Connects the archive specifications query to the specification list view.

---

## 5. Public API and Import Boundaries

### Explicit Direct Imports Preferred

- **Direct Imports:** Import components and utilities directly from their defining files (e.g. `import { Button } from '@/shared/ui/button';`, `import { useSpecificationIndex } from '@/features/specifications/queries';`).
- **No Wildcard Re-Exports:** Catch-all barrel files using `export * from '...'` are prohibited. Explicit named exports ensure clear symbol provenance and avoid circular dependency risks.
- **Relative vs. Root-Relative Imports:**
  - Within the same feature or directory: use relative paths (`../status`, `./types`).
  - Across architectural layers: use the `@/` path alias (`@/shared/ui/button`, `@/screens/specification-detail-screen`, `@/features/specifications/queries`).

---

## 6. Consolidated Shared UI (`ui/shared/ui/`)

All domain-independent UI primitives reside in a single, unified directory: `tools/dashboard/ui/shared/ui/`.

```text
tools/dashboard/ui/shared/ui/
├── badge.tsx & badge.stories.tsx
├── button.tsx & button.stories.tsx
├── card.tsx & card.stories.tsx
├── dialog.tsx & dialog.stories.tsx
├── loading-screen.tsx & loading-screen.stories.tsx
├── progress.tsx & progress.stories.tsx
├── sheet.tsx & sheet.stories.tsx
├── status-card.tsx & status-card.stories.tsx
└── status-label.tsx
```

- **Tooling Alignment:** The shadcn CLI configuration (`tools/dashboard/components.json`) configures `"ui": "@/shared/ui"` and `"components": "@/shared/ui"`.
- **Elimination of `ui/components/ui/`:** The historical `ui/components/ui/` scaffolding directory has been eliminated. All callers import shared primitives from `@/shared/ui/<primitive>`.

---

## 7. Styling Infrastructure & Legacy Variable Bridge (`ui/index.css`)

`tools/dashboard/ui/index.css` is the production styling entry point imported by `main.tsx`. It defines:

1. **Tailwind CSS 4 Theme (`@theme static`):**
   Canonical design tokens declaring neutral foundations, foreground hierarchy, interaction colors, canonical status colors, provider colors, and diff indicators:
   ```css
   @theme static {
     --color-background: #090a0d;
     --color-surface: #0f1116;
     --color-surface-raised: #14171d;
     --color-surface-hover: #191d24;
     --color-border: #252a33;
     --color-border-strong: #343b47;
     --color-fg-primary: #f1f3f5;
     --color-fg-secondary: #c7cdd6;
     --color-fg-muted: #929baa;
     --color-fg-on-accent: #f8fafc;
     --color-accent: #3882f6;
     --color-accent-solid: #1d4ed8;
     --color-status-success: #35c76f;
     --color-status-warning: #f59e0b;
     --color-status-error: #ef4444;
     --color-status-attention: #a78bfa;
     --color-status-info: #06b6d4;
     --color-action-destructive: #ef4444;
     --color-provider-claude: #fb923c;
     --color-provider-antigravity: #60a5fa;
     --color-workflow-design: #8b5cf6;
     --color-backdrop: rgb(0 0 0 / 70%);
   }
   ```

2. **Legacy Variable Bridge (`:root`):**
   Provides backward compatibility for CSS custom properties by referencing canonical tokens via `var(--color-*)`:
   ```css
   :root {
     color-scheme: dark;
     --background: var(--color-background);
     --surface: var(--color-surface);
     --surface-raised: var(--color-surface-raised);
     --surface-hover: var(--color-surface-hover);
     --border: var(--color-border);
     --border-strong: var(--color-border-strong);
     --foreground: var(--color-fg-primary);
     --muted: var(--color-fg-muted);
     --muted-strong: var(--color-fg-secondary);
     --accent: var(--color-accent);
     --accent-strong: var(--color-accent-solid);
     --accent-foreground: var(--color-fg-on-accent);
     --success: var(--color-status-success);
     --warning: var(--color-status-warning);
     --danger: var(--color-status-error);
     --info: var(--color-status-info);
     --lane-design: var(--color-workflow-design);
     --cat-1: var(--color-provider-claude);
     --cat-2: var(--color-provider-antigravity);
     /* Derived color-mix values where distinct semantic tokens do not exist */
     --accent-muted: color-mix(in srgb, var(--accent) 10%, transparent);
     --accent-border: color-mix(in srgb, var(--accent) 35%, var(--border));
     ...
   }
   ```
   Equivalence between legacy bridge variables and canonical tokens is verified in `ui/foundations/token-resolver.stories.tsx`.

---

## 8. State Management and Data Fetching

State is classified into four operational categories:

1. **Server State (TanStack Query):** Remote REST resources (specifications list, PR queries, provider configuration) are queried and cached via `@tanstack/react-query`.
2. **Realtime & Streaming State:** Long-lived streaming events (AI session turns, terminal operations) are managed by dedicated transport layers (`agent-session-transport.ts`) and event reducers (`agent-event-reducer.ts`), shielding React components from raw SSE connection details.
3. **View Models and Projections:** High-frequency streaming data and complex payloads are transformed into presentation-ready view models using pure deterministic functions (`timeline-projection-v2.ts`, `lane-presentation.ts`), unit-tested in isolation.
4. **Local UI State:** Ephemeral interaction state (dialog open/close, active tab, hover states, draft inputs) is managed locally via React hooks (`useState`, `useReducer`, `useRef`).

---

## 9. Storybook and Testing Colocation

- **Story Colocation:** Component story files (`*.stories.tsx`) are co-located in the same directory as their corresponding component.
- **Storybook Naming Hierarchy:**
  - Primitives: `Shared/UI/<ComponentName>` (e.g. `Shared/UI/Button`, `Shared/UI/Sheet`)
  - Shared: `Shared/<Area>/<ComponentName>` (e.g. `Shared/Markdown/MarkdownContent`)
  - Features: `Features/<Domain>/<ComponentName>` (e.g. `Features/Specifications/Status Board`)
  - Foundations: `Foundations/<Topic>` (e.g. `Foundations/Colors`, `Foundations/Typography`, `Foundations/TokenResolver`)
- **Test Utilities Isolation:** Storybook testing utilities reside in `.storybook/test-utils/` and are imported via `@storybook-test-utils`. Production UI code does not import from `.storybook/`.

---

## 10. Component Placement Decision Matrix

When creating or placing a frontend file, follow this decision matrix:

| Evaluation Question | If YES: Destination | If NO: Next Step |
|---|---|---|
| **1. Is this a route entry point for TanStack Router?** | `tools/dashboard/ui/routes/` | Proceed to question 2 |
| **2. Is this an application root bootstrap or router configuration?** | `tools/dashboard/ui/app/` (or `App.tsx`) | Proceed to question 3 |
| **3. Is this a page-level screen that composes multiple domain features?** | `tools/dashboard/ui/screens/` | Proceed to question 4 |
| **4. Does this component implement logic, views, or queries for a specific feature (`agent-sessions`, `specifications`, `pull-requests`, `operations`)?** | `tools/dashboard/ui/features/<domain>/` | Proceed to question 5 |
| **5. Is this component a domain-agnostic UI primitive (button, card, dialog, badge, sheet, status-card)?** | `tools/dashboard/ui/shared/ui/` | Proceed to question 6 |
| **6. Is this a domain-agnostic composite (markdown renderer, utility hook)?** | `tools/dashboard/ui/shared/<area>/` | Proceed to question 7 |
| **7. Is this a design token verification story or design system catalog?** | `tools/dashboard/ui/foundations/` | Re-evaluate component scope |

---

## 11. Verified Directory Layout

The following reflects the verified repository layout on disk:

```text
tools/dashboard/
├── .storybook/                          # Storybook configuration & test utilities
│   ├── test-utils/                      # Browser test helpers & color resolver
│   │   ├── color-helpers.ts
│   │   ├── interaction-helpers.ts
│   │   └── index.ts
│   ├── main.ts
│   └── preview.tsx
├── components.json                      # shadcn config (aliases "ui" to @/shared/ui)
├── ui/
│   ├── app/                             # Application router setup
│   │   └── router.ts
│   ├── routes/                          # TanStack file routes (thin parameter binders)
│   │   ├── __root.tsx
│   │   ├── _spec-layout.tsx
│   │   ├── _spec-layout/
│   │   │   ├── index.tsx
│   │   │   ├── archive.tsx
│   │   │   └── specs.$source.$slug.tsx
│   │   └── specs.$source.$slug.sessions.$provider.$providerSessionId.tsx
│   ├── screens/                         # Multi-feature page composition layer
│   │   ├── active-specifications-screen.tsx
│   │   ├── agent-session-screen.tsx
│   │   ├── archive-specifications-screen.tsx
│   │   ├── specification-console-layout.tsx
│   │   └── specification-detail-screen.tsx
│   ├── features/                        # Single-domain vertical slices
│   │   ├── agent-sessions/              # AI sessions, chat surface, Work V2 timeline
│   │   ├── specifications/              # Specification status board, tasks, docs
│   │   ├── pull-requests/               # Pull request cards, diff inspection
│   │   └── operations/                  # Background operation progress & modal
│   ├── shared/                          # Domain-agnostic shared layer
│   │   ├── ui/                          # Consolidated UI primitives
│   │   │   ├── badge.tsx & badge.stories.tsx
│   │   │   ├── button.tsx & button.stories.tsx
│   │   │   ├── card.tsx & card.stories.tsx
│   │   │   ├── dialog.tsx & dialog.stories.tsx
│   │   │   ├── loading-screen.tsx & loading-screen.stories.tsx
│   │   │   ├── progress.tsx & progress.stories.tsx
│   │   │   ├── sheet.tsx & sheet.stories.tsx
│   │   │   ├── status-card.tsx & status-card.stories.tsx
│   │   │   └── status-label.tsx
│   │   ├── markdown/                    # Markdown rendering components
│   │   └── status-tone.ts               # Canonical StatusTone contract
│   ├── foundations/                     # Design system catalog stories
│   │   ├── colors.stories.tsx
│   │   ├── smoke.stories.tsx
│   │   ├── token-resolver.stories.tsx
│   │   └── typography.stories.tsx
│   ├── lib/
│   │   └── utils.ts                     # cn utility and date/status formatters
│   ├── App.tsx                          # Root application component
│   ├── index.css                        # Tailwind 4 theme & legacy CSS bridge
│   ├── index.html                       # HTML entry point
│   ├── main.tsx                         # DOM mounting entry point
│   └── routeTree.gen.ts                 # Generated TanStack router manifest
└── vitest.config.ts                     # Vitest unit & Storybook browser runner config
```

---

## 12. Verification Commands

The frontend architecture and implementation are verified with the following commands:

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
