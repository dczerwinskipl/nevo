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
- [ ] **Existing-primitive check:** Does an existing design token, Radix primitive, or shared UI component wrapper already cover this element or interaction before creating custom markup?
- [ ] **Existing-variant check:** Does an existing `cva()` variant or semantic tone already express this visual style before adding a new prop or variant branch?
- [ ] **Classification check:** Are classes cleanly separated into one-off local layout (inline in JSX), reusable visual API (`cva()`), or domain status projection (canonical domain state → `StatusTone` → component variant)?
- [ ] **Visual-vs-orchestration check:** Does the visual component remain pure and decoupled from data-fetching, session lifecycle, or workflow mutations?
- [ ] **Hidden-boolean-variant check:** Are multiple ad-hoc boolean styling props (e.g. `isError`, `isWarning`, `requiresAttention`) avoided in favor of a single explicit `variant` or `tone` prop?
- [ ] **Existing-Storybook-coverage check:** Has existing Storybook coverage under `tools/dashboard/ui` been inspected for the component being touched?
- [ ] **Additional-story / behavior-test-need check:** Are new or modified variants, interaction states, and accessibility contracts covered by new or updated stories and behavior tests?

---

# 12. Tailwind class composition

This section defines the durable contract for composing Tailwind CSS classes in React components across `tools/dashboard/ui/**`.

## 12.1 Local static layout

One-off structural classes (margins, padding, flexbox/grid layouts, alignment, dimensions, positioning, and gap spacing) stay inline in JSX.

A long but static, cohesive class list is not automatically an architectural problem or an extraction reason. Do not extract a class string into a constant or helper solely to shorten JSX or hide CSS classes outside the component. Keep styling co-located with the JSX element it shapes unless it forms a reusable visual variant API.

## 12.2 Reusable component variants

Use `cva()` (Class Variance Authority) whenever a component has a stable visual API with multiple visual options (`variant`, `tone`, `size`, `emphasis`, `density`).

- **Recipe co-location:** Keep the `cva()` recipe beside the component in the same module (or in a sibling module when the primitive is large).
- **Type derivation:** Derive component props directly via `VariantProps<typeof componentVariants>`.
- **Compound variants discipline:** Use `compoundVariants` only for genuine cross-axis interactions (e.g., when a specific combination of `variant` and `size` requires special padding or font sizing). Treat a large compound variant matrix as a signal to inspect whether the component is mixing unrelated responsibilities or whether domain state has leaked into its visual API.

## 12.3 Domain state and presentation tone

Domain state must **never** directly select Tailwind classes in JSX.

The required presentation pipeline flows through explicit architectural stages:

$$\text{Canonical domain state} \longrightarrow \text{Semantic presentation tone} \longrightarrow \text{Component variant} \longrightarrow \text{Tailwind utility} \longrightarrow \text{Theme token}$$

### Canonical `StatusTone` type

All status and severity presentations standardize on the following canonical union type:

```ts
type StatusTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'warning'
  | 'error'
  | 'attention'
  | 'info';
```

### Tone projection rules

- A visual presentation component receives `tone: StatusTone` (or a component variant derived from it), never raw backend/provider status strings (e.g. `'running'`, `'failed'`, `'completed'`) or ad-hoc booleans like `isError`, `isWarning`, or `requiresAttention`.
- Keep canonical-status-to-tone mappings feature-local by default. Generalize or promote to shared code only when multiple independent features genuinely share the exact same canonical contract. For example, the codebase intentionally maintains focused feature-local mappings:
  - `tools/dashboard/ui/shared/ui/status-label.tsx`'s `statusTone()` for specification and session list items;
  - `tools/dashboard/ui/features/agent-sessions/transcript/projection.ts`'s `computePresentationSeverity()` for session transcript turn work;
  - `tools/dashboard/ui/features/agent-sessions/work-v2/`'s attention projection for Work V2 indicators;
  - `tools/dashboard/ui/features/pull-requests/changes/status.ts`'s `stateTone()` for pull-request file changes.

## 12.4 DOM and interaction state

Use native Tailwind variant modifiers (`hover:`, `focus-visible:`, `disabled:`, `aria-selected:`, `data-[state=open]:`, `group-*`, `peer-*`) for states already owned by the browser DOM element or behavior primitive (such as Radix UI).

Do not introduce a React boolean state or prop solely to reproduce interaction or accessibility states that are already exposed via native HTML attributes, ARIA states, or Radix `data-*` attributes.

## 12.5 Conditional composition

Use `cn()` (`clsx` + `tailwind-merge`) as the standard utility for conditional inclusion and consumer className overrides:

```tsx
cn(componentVariants({ tone, size }), className)
```

- `cn()` resolves Tailwind utility conflicts and merges custom classes passed by consumers.
- `cn()` is **not** a substitute for a component variant model (`cva()`) or a domain-state-to-tone projection.
- Do not accumulate large collections of unrelated boolean ternary class expressions inside `cn()`. When branching logic grows, express it through a `cva()` recipe or a typed mapping dictionary.

## 12.6 Tailwind source detection

Every possible Tailwind utility class must exist in source code as a complete, static string literal so that Tailwind's static analysis scanner can discover and generate the required CSS.

- **Banned pattern:** Never construct class names using dynamic string interpolation or concatenation:
  ```tsx
  // BANNED: Tailwind compiler cannot detect interpolated dynamic classes
  const className = `text-status-${tone}`;
  const badgeClass = `bg-${color}-500`;
  ```
- **Required pattern:** Use a typed static map or `cva()` where every class appears as a complete, searchable string literal:
  ```tsx
  const toneClasses: Record<StatusTone, string> = {
    neutral: 'text-status-neutral',
    active: 'text-status-active',
    success: 'text-status-success',
    warning: 'text-status-warning',
    error: 'text-status-error',
    attention: 'text-status-attention',
    info: 'text-status-info',
  };
  ```

## 12.7 Multi-slot components

For compound components with multiple internal sub-elements (e.g., `root`, `icon`, `title`, `description`, `actions`):

- Keep a small, typed slot recipe local to the component, using one focused `cva()` recipe per slot where readable.
- Avoid duplicating domain-status or tone decisions across individual slots. The parent component should resolve the presentation tone once and pass it down or apply the corresponding slot classes.
- Do not introduce a heavy external multi-slot/variants library unless repeated multi-slot complexity across several independent primitives demonstrates a real need.

## 12.8 CSS and `@apply`

Reserve custom CSS rules and `@apply` directives exclusively for selector-oriented or non-React-boundary requirements:

- Rendered Markdown and prose content (`.markdown-content` styling);
- Third-party library markup, overlays, or injected DOM outside direct React component control;
- Global pseudo-elements and browser scrollbars;
- Document-level root styling and browser reset behaviors.

Never move ordinary component variants or layout rules into global CSS or `@apply` blocks merely to shorten JSX class lists.

## 12.9 Required inspection when touching a component

Whenever introducing or modifying a React component under `tools/dashboard/ui/**`, apply this 7-item inspection sequence:

1. **Existing-primitive check:** Verify whether an existing design token, Radix primitive, or shared UI wrapper (`tools/dashboard/ui/components/ui/*`) already provides the required element or interaction before creating custom markup.
2. **Existing-variant check:** Verify whether an existing `cva()` variant or semantic tone already expresses the needed presentation before introducing a new variant prop or branch.
3. **Local-layout vs. recipe vs. domain-mapping classification:** Clearly classify every styling concern into one-off local layout (kept inline in JSX), reusable visual variant APIs (managed via `cva()`), or domain status derivations (projected via canonical state → `StatusTone`).
4. **Visual-vs-orchestration check:** Ensure visual presentation components remain pure and decoupled from data orchestration, network queries, and lifecycle side effects.
5. **Hidden-boolean-variant check:** Avoid introducing ad-hoc boolean styling props (e.g., `isError`, `isWarning`, `requiresAttention`); express visual state through explicit `variant` or `tone` properties.
6. **Existing-Storybook-coverage check:** Review existing Storybook stories under `tools/dashboard/ui` to determine current visual coverage and prevent regressions.
7. **Additional-story / behavior-test-need check:** Determine whether new stories or behavior tests are required to document and verify new variants, interaction states, or accessibility behavior.
