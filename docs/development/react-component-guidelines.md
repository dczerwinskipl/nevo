---
id: development.react-component-guidelines
type: development
title: React component and module guidelines
status: current
read_when:
  - creating or restructuring React components
  - React or frontend changes
  - React component or module refactoring
  - changing shared UI, hooks, or feature modules
  - introducing dialogs, drawers, menus, tooltips, or other interactive primitives
  - extracting reusable components
  - changing styling or status/color presentation
summary: >
  Practical architecture guidelines for React UI code: component composition, module and
  file boundaries, "one primary concept per module", feature-local vertical ownership,
  token -> primitive -> wrapper -> feature layering, state/effect/context ownership,
  view-model projections, testing, and anti-mechanical refactoring principles.
related:
  - development.coding-conventions
  - development.architecture-overview
  - development.node-tooling-guidelines
---

# React Component and Module Guidelines

## Purpose and Repository Context

This document defines the preferred way to structure React UI code.

**Repository context:** The NEvo repository is primarily a .NET project. Node tooling, the developer dashboard, and the AI orchestration layer currently reside in this repository because it is easier to develop, test, and verify end-to-end integration here. Eventually, most of this developer tooling will be extracted into a dedicated tooling repository.

Therefore, these guidelines are:
- practical for the current `tools/dashboard` codebase;
- portable to a future standalone tooling repository;
- strictly scoped to React UI and frontend tooling;
- designed to maintain clear boundaries without altering the overarching .NET-centric architecture of NEvo.

The goal is not to maximize the number of components or files. The goal is to make UI code easy to understand, compose, test, change, and move between repositories without carrying accidental coupling.

---

# How to apply this guideline

Before planning or executing any frontend refactoring, apply these rules:

1. **Decision criteria, not a target file tree:** This document provides architectural heuristics and decision criteria, not an obligatory file tree. Example directory structures and module names in this guide are illustrative.
2. **Do not refactor solely based on file size:** Never create a refactoring task or split a file solely because it has many lines of code.
3. **Multiple components in one file are often correct:** Do not extract components into separate files solely because more than one component definition exists in a file.
4. **Do not mimic examples blindly:** Do not reorganize code merely to make its directory layout look like an example snippet from this guideline.
5. **Smallest structural change:** Prefer the smallest structural change that improves a real, observable boundary of responsibility, testability, or lifecycle ownership.

---

# 1. Core principles

## 1.1 Prefer small, focused components

A component should have one clear responsibility.

Good reasons to split a component:
- it renders a distinct visual concept;
- it owns a distinct interaction contract (e.g. dialog, menu, editor, drawer);
- it owns state, effects, subscriptions, timers, or browser lifecycle separate from its parent;
- it can be tested meaningfully in isolation;
- it contains logic that obscures the parent's primary intent;
- it changes for a different reason than the rest of the parent;
- extracting it makes the feature composition substantially easier to read.

Do not split components solely to satisfy an arbitrary line-count rule.

Prefer:

```tsx
<ChatHeader />
<Conversation />
<WorkSummary />
<Composer />
```

over one component containing layout, data fetching, event projection, interaction state, effects, modal dialogs, and markup.

A page or feature container component should read primarily as composition and orchestration.

## 1.2 Prefer composition over configuration-heavy components

Prefer composing focused parts through `children`, slots, or small subcomponents.

Avoid components that accumulate many unrelated booleans or variants to represent distinct concepts. If independent flags materially change responsibility or structure, inspect whether the component should be split instead.

## 1.3 Split by responsibility, not by architectural ceremony

Do not create `FooView`, `FooContainer`, `useFooModel`, `FooService`, and `Foo.types.ts` merely because such layers are theoretically possible.

Create a boundary when it makes ownership, testing, reuse, or change isolation clearer. A 20-line file that adds no meaningful boundary is not automatically better than a cohesive module.

---

# 2. Component and module organization

## 2.1 Default: one primary concept per module

A React module should normally have **one primary exported concept**.

That concept may be:
- a component;
- a feature hook;
- a projection or view-model function;
- a context provider;
- a reusable UI primitive.

This is a default heuristic, not a dogmatic "one component per file" rule. A module may legitimately contain small private helpers and private components when they are implementation details of the primary concept.

## 2.2 When a helper component may stay in the parent file

A private helper component should remain beside its parent when:
- it is a private rendering detail used only by that module;
- it is small, simple, and easy to understand;
- it has no significant independent state of its own;
- it has no independent lifecycle;
- it has no subscriptions, timers, viewport, focus, or keyboard event logic;
- it changes for the same reason as its parent;
- extracting it would mostly add file count and navigation friction without improving ownership or testability.

Typical examples:
- a small metric badge or summary row;
- a local icon-and-label fragment;
- a short empty-state placeholder;
- a tiny presentational item rendered inside a list.

Do not extract every JSX fragment into its own file.

## 2.3 When a component should get its own module

A component is a strong candidate for its own module when it owns a real, independent responsibility, such as:
- it owns an independent interaction contract (e.g. a dialog, drawer, menu, editor, or composer);
- it owns independent state, hooks, or lifecycle;
- it manages focus, keyboard events, viewport listeners, timers, or subscriptions;
- it has a meaningful props contract that can be understood independently;
- it contains substantial conditional rendering or state branching;
- it can be tested meaningfully in isolation;
- it changes independently from the parent;
- extracting it makes the parent component substantially easier to understand as orchestration.

**Reuse is not required to justify an independent module.** A component used in only one feature can still deserve its own file because it owns a separate interaction or lifecycle responsibility.

## 2.4 Prefer feature-local vertical ownership

**«Prefer feature-local vertical ownership when component, interaction behavior, projection, and tests belong to the same feature. Promote only genuinely shared primitives or behavior to global/shared modules.»**

When a feature or product capability has meaningful behavior of its own, prefer keeping its constituent parts together:
- visual and container components;
- interaction behavior and dialog contracts;
- feature-local hooks;
- projections and view-model transformations;
- feature-specific tests.

Prefer keeping these concepts close to the feature rather than scattering them automatically across global technical-layer folders such as:

```text
# Avoid premature horizontal scattering:
components/   ← every component in the repo
hooks/        ← every hook in the repo
models/       ← every projection in the repo
utils/        ← every helper in the repo
```

Instead, keep feature-specific code vertically owned by the feature. Promote code to global/shared directories (`src/components/ui/`, `src/hooks/`, `src/lib/`) only when there is genuine cross-feature reuse or it represents an application-wide primitive.

**Important clarifications:**
- This does **not** mean every feature requires a dedicated directory.
- This does **not** mean every component needs its own vertical slice.
- This does **not** mean every feature must have component, hook, model, and test files.
- Existing cohesive code should **never** be reorganized solely to match a vertical-slice pattern.
- A small feature may remain in a single, cohesive module.

## 2.5 Feature directories

Do not create a directory for every single component by default. Start with a single module when a feature is small.

Create a feature directory only when a feature develops real internal structure with multiple collaborating responsibilities, for example:

```text
chat/
  ai-chat.tsx               # Orchestration and composition
  conversation.tsx          # Message stream visual component
  session-dialog.tsx        # Independent modal interaction
  use-chat-viewport.ts      # Viewport and scroll lifecycle (feature-local hook)
  chat-view-model.ts        # Pure data projection logic (feature-local projection)
  chat-view-model.test.ts   # Pure unit tests (feature-local test)
```

A feature directory is justified when it groups files that:
- belong to the same product capability;
- are not general-purpose shared UI;
- collaborate closely;
- would otherwise clutter a broad global directory.

Keep feature-specific hooks, view models, and helpers **feature-local** until there is genuine, proven reuse across independent features.

## 2.6 Promote code upward only when reuse is real

Keep code feature-local until a real shared concept emerges. Promote to shared UI or shared hooks only when:
- multiple independent features genuinely require the same semantic concept;
- the API is stable enough to describe and test independently;
- sharing removes duplication without introducing a generic, catch-all abstraction.

Do not promote code solely because two implementations look visually similar. Reuse should follow semantic similarity, not visual coincidence.

---

# 3. File size is an inspection trigger, not an extraction reason

Do not enforce hard or soft maximum LOC limits.

**File size may trigger inspection, but it must not be the architectural reason for extraction.**

A large file should prompt a review of module cohesion, but refactoring is justified only when a concrete architectural problem is present:
- multiple independent responsibilities mixed in one file;
- multiple independent lifecycle owners (timers, listeners, subscriptions);
- several stateful, complex components accumulating together;
- mixing high-level orchestration, rendering details, and browser lifecycle behavior;
- heavy data transformations and projection logic embedded directly in JSX;
- independent interaction contracts (e.g. embedded modal dialogs with complex state);
- difficulty understanding the primary component due to unrelated implementation noise.

A large module that represents a single, cohesive, deterministic projection or specialized renderer can be completely valid and easier to maintain in one place. Conversely, a small module that mixes fetching, mutations, timers, and rendering may need decomposition despite low line count.

Responsibility, lifecycle boundaries, and change reasons take precedence over line count.

---

# 4. UI architecture and layering

Use the following conceptual layering:

```text
Design tokens (colors, spacing, surface levels)
    ↓
Behavior primitives (Radix UI / accessibility primitives)
    ↓
Application-owned UI primitives (Button, Dialog, Card, Sheet)
    ↓
Reusable visual components
    ↓
Feature components & feature-local modules (dialogs, hooks, view models)
    ↓
Pages / workspace composition
```

These represent dependency directions, not mandatory directories.

## 4.1 Design tokens

Use shared semantic tokens for known meanings (e.g. success, warning, danger, info, muted surfaces, borders). Feature components should express intent through semantic tokens rather than hardcoded palette values or raw magic colors.

## 4.2 Behavior primitives

Prefer established, accessible primitive libraries for complex interaction behavior.
For the current frontend stack:
- **Radix UI** = accessible interaction behavior (dialogs, popovers, dropdowns, tooltips);
- **Tailwind CSS + semantic tokens** = styling;
- **Application-owned wrappers** (`components/ui/*`) = feature-facing API.

Prefer existing application wrappers for dialogs, sheets, menus, and tooltips. Do not hand-roll focus trapping, Escape key handling, portals, or backdrop behavior when an established primitive already solves it.

## 4.3 One general interaction foundation

Do not mix multiple competing general-purpose UI component frameworks without an explicit architectural decision. Specialized libraries (e.g. diff viewers, code editors, charts) remain acceptable when they solve a distinct capability.

---

# 5. Visual components vs orchestration

## 5.1 Visual components

A visual component should primarily:
- receive typed props;
- render UI elements;
- emit user intentions through callback props;
- own local visual state where appropriate (e.g. hover, local open/closed toggle);
- avoid knowing how data is fetched, cached, or persisted.

## 5.2 Container components and feature hooks

A container / smart layer may:
- fetch or query server data;
- dispatch mutations;
- coordinate routing and navigation;
- manage side effects and browser lifecycle;
- translate domain state into view-model props;
- handle server error states.

Do not force an artificial visual/container split for trivial components. Separate these concerns when the combined component becomes difficult to understand, test, or evolve.

## 5.3 Keep orchestration visible

A page or feature entry component should make feature flow obvious at a glance. It coordinates hooks and subcomponents rather than containing inline implementations of every subfeature.

---

# 6. Hooks and browser lifecycle

## 6.1 Extract hooks by behavior ownership

A custom hook is a good extraction candidate when it owns a coherent behavior:
- viewport, scroll, or keyboard tracking;
- event subscriptions and SSE streams;
- polling and timer management;
- complex session or form lifecycle;
- coordinated mutations with optimistic updates.

Keep feature-specific hooks beside the feature. Move a hook to a shared directory only when several independent features genuinely share the behavior.

## 6.2 Avoid hook catch-alls

Do not create giant multi-hundred-line `useFeature()` hooks containing all queries, mutations, timers, projections, navigation, and local state. Split hooks when they represent distinct lifecycles or capabilities.

---

# 7. View models and data transformation

Keep significant data transformations out of JSX.

Prefer:

```text
raw events / API responses
        ↓
pure projection / selector / view-model function (feature-local by default)
        ↓
visual components
```

Projection logic should be deterministic and independently testable with fast unit tests. Build view models close to the feature consuming them. Promote to shared `src/lib/` only when multiple independent features require the same projection. Do not create view models ceremonially for trivial 1-to-1 prop mapping.

## 7.1 View-model boundaries follow change boundaries

Group values that come from the same logical source and change together. Do not combine static metadata with high-frequency streaming state merely to reduce prop count.

---

# 8. State ownership and effects

## 8.1 State placement

Keep state as close as practical to the component or feature that owns it:
- local component state for transient visual state;
- feature hooks for feature interaction workflows;
- server query cache (TanStack Query) for server-persisted state;
- shared/global state only when distant surfaces genuinely need synchronized client-side state.

Do not duplicate derived state. Do not mirror query/props data into local state unless the local value represents an independently editable draft.

## 8.2 Effects are for synchronization

Use `useEffect` to synchronize React components with external systems (DOM events, timers, websockets, external libraries). Do not use effects for calculating derived state or sequencing state updates.

---

# 9. Accessibility and responsive design

Shared primitives must own accessibility behavior: focus management, Escape key handling, keyboard navigation, ARIA roles/states, and focus restoration. Use semantic HTML before custom ARIA.

Do not treat responsive layouts as a CSS afterthought. Test narrow widths, collapsible panels, and long content flows. Desktop and mobile layouts may use different compositions over the same underlying view model without duplicating business logic.

---

# 10. Testing strategy

Test logic at the responsibility level where it lives:

1. **Projection / View-model logic:** Pure unit tests for data transformations, event filtering, sorting, status derivation, and grouping (kept feature-local beside the projection where practical).
2. **Visual components:** Observable behavior tests (visible content, accessibility attributes, callback invocation, expand/collapse, disabled states) using React Testing Library and Vitest in `tools/dashboard` (configured in `tools/dashboard/vitest.config.ts`, run via `npm --prefix tools/dashboard run test:storybook`, with stories and tests documented in [storybook.md](storybook.md)).
3. **Smart / Orchestration components:** Integration tests for query/mutation contracts, error handling, and parameter routing.

Avoid relying exclusively on broad, brittle snapshot tests.

---

# 11. Review checklist

When creating or reviewing React UI code, verify:

- [ ] Does each primary module represent one clear concept?
- [ ] Is feature-local vertical ownership preferred over premature scattering into global technical folders?
- [ ] Are small private render helpers kept local rather than creating unnecessary files?
- [ ] Do separate modules exist for independent interaction contracts (dialogs, menus, editors)?
- [ ] Is a feature directory used only when the feature has real internal structure?
- [ ] Are feature-specific hooks, view models, and helpers kept feature-local?
- [ ] Is file size being used solely as an inspection trigger rather than an extraction rule?
- [ ] Are heavy data transformations kept out of JSX and tested as pure functions?
- [ ] Are established design tokens and Radix accessibility primitives used?
- [ ] Is state owned at the narrowest sensible level without duplicating derived state?
- [ ] Are effects used strictly for synchronization with external systems?
- [ ] Are tests focused at the level of responsibility they verify?
