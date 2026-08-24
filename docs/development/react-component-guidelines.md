---
id: development.react-component-guidelines
type: development
title: React component and module guidelines
status: current
read_when:
  - creating or restructuring React components
  - changing shared UI
  - introducing dialogs, drawers, menus, tooltips, or other interactive primitives
  - extracting reusable components
  - changing styling or status/color presentation
  - refactoring large feature components
  - reorganizing React files, hooks, view models, or feature modules
summary: >
  Preferred way to structure React UI code: component composition, module/file
  boundaries, token -> primitive -> wrapper -> feature layering, state/effect/context
  ownership, view-model boundaries, accessibility, testing, and pragmatic size smells.
  Treat this as required guidance for frontend implementation and refactoring when
  explicitly attached to a task.
related:
  - development.coding-conventions
  - development.architecture-overview
---

# React Component and Module Guidelines

## Purpose

This document defines the preferred way to structure React UI code.

The goal is not to maximize the number of components or files. The goal is to make UI code easy to understand, compose, test, change, and move between repositories without carrying accidental coupling.

Use architectural responsibility as the primary reason to split code. File size is a review signal, not a design rule.

---

# 1. Core principles

## 1.1 Prefer small, focused components

A component should have one clear responsibility.

Good reasons to split a component:

- it renders a distinct visual concept;
- it owns a distinct interaction;
- it owns state, effects, subscriptions, or browser lifecycle separate from its parent;
- it can be tested meaningfully in isolation;
- it contains logic that obscures the parent;
- it changes for a different reason than the rest of the parent;
- extracting it makes the feature composition substantially easier to read.

Do not split components solely to satisfy a line-count rule.

Prefer:

```tsx
<ChatHeader />
<Conversation />
<WorkSummary />
<Composer />
```

over one component containing layout, fetching, event projection, interaction state, effects, dialogs, and markup.

A page or feature component should read primarily as composition and orchestration.

## 1.2 Prefer composition over configuration-heavy components

Prefer composing focused parts through `children`, slots, or small subcomponents.

Avoid components that accumulate many unrelated booleans or variants to represent distinct concepts.

If independent flags materially change responsibility or structure, inspect whether the component should be split instead.

## 1.3 Split by responsibility, not by architectural ceremony

Do not create `FooView`, `FooContainer`, `useFooModel`, `FooService`, and `Foo.types.ts` merely because such layers are possible.

Create a boundary when it makes ownership, testing, reuse, or change isolation clearer.

A 20-line file that adds no meaningful boundary is not automatically better than a 120-line cohesive module.

---

# 2. Component and file organization

## 2.1 Default: one primary concept per module

A React module should normally have one primary exported concept.

That concept may be:

- a component;
- a feature hook;
- a projection/view-model function;
- a context/provider;
- a reusable UI primitive.

This is a default, not a hard rule.

A module may contain small private helpers and private components when they are implementation details of the primary concept.

The purpose of this rule is to avoid files that become informal containers for several independently evolving features.

## 2.2 When a helper component may stay in the same file

A private component may stay beside its parent when most of the following are true:

- it is small and easy to understand;
- it is used only by that module;
- it has no independent data fetching;
- it has no meaningful side effects, subscriptions, timers, or browser lifecycle;
- it has little or no independent interaction state;
- it changes for the same reason as its parent;
- extracting it would mostly add navigation between files without clarifying ownership.

Typical examples:

- a small metric row;
- a local icon-and-label fragment;
- a short empty-state fragment;
- a tiny presentational item used only by its parent.

Do not extract every JSX fragment into a component.

## 2.3 When a component should get its own module

A component is a strong candidate for its own module when one or more of these are meaningful:

- it owns an interaction contract such as a dialog, menu, editor, composer, or expandable panel;
- it owns hooks or effects;
- it manages focus, keyboard, viewport, timers, subscriptions, or other lifecycle behavior;
- it has a meaningful props contract that can be understood independently;
- it contains substantial conditional rendering;
- it is independently testable;
- it is reusable;
- it changes independently from the parent;
- the parent becomes substantially easier to understand after extraction.

Reuse is not required for extraction.

A component used in only one feature can still deserve a separate module because it owns a separate responsibility.

## 2.4 Avoid many unrelated component definitions in one large file

Several tiny private render helpers are acceptable.

Several stateful or independently behaving components in the same file are usually a smell.

If a file contains a page, a dialog, a viewport hook, a complex panel, data projection, and command orchestration, the problem is not the line count. The file contains several architectural responsibilities.

## 2.5 Feature directories

Do not create a directory for every component by default.

Start with a single module when a feature is small.

Create a feature directory when the feature develops an internal structure, for example:

```text
chat/
  ai-chat.tsx
  conversation.tsx
  session-dialog.tsx
  use-chat-viewport.ts
  chat-view-model.ts
  chat-view-model.test.ts
```

A feature directory is justified when it groups several files that:

- belong to the same product capability;
- are not general-purpose shared UI;
- collaborate closely;
- would otherwise pollute a broad global folder.

Prefer feature-local organization over global catch-all folders such as `hooks/`, `utils/`, or `models/` when code is used by only one feature.

## 2.6 Promote code upward only when reuse is real

Keep code feature-local until there is a real shared concept.

Promote to shared UI or shared hooks when:

- multiple features need the same semantic concept;
- the API is stable enough to describe independently;
- sharing removes duplication without creating a generic catch-all abstraction.

Do not promote code solely because two implementations look visually similar.

Reuse should follow semantic similarity, not visual coincidence.

---

# 3. File size is a smell, not a limit

Do not enforce hard maximum LOC rules.

Use file size to trigger architectural review.

Practical review signals:

- around **200 LOC for a single component**: inspect whether rendering, interaction, and data orchestration are still cohesive;
- around **300 LOC for a React module**: inspect whether more than one meaningful responsibility has accumulated;
- around **500 LOC or more**: treat the module as a strong architecture smell that requires explicit justification.

These are intentionally approximate.

A cohesive 350-line projection or specialized renderer may be acceptable.

A 140-line component that mixes fetching, mutations, viewport listeners, timers, and conditional JSX may already need decomposition.

Responsibility, lifecycle, and change boundaries take precedence over LOC.

---

# 4. UI architecture

Use the following conceptual layering:

```text
Design tokens
    ↓
Behavior primitives
    ↓
Application-owned UI primitives
    ↓
Reusable visual components
    ↓
Feature components
    ↓
Feature hooks / view models / orchestration
    ↓
Pages / workspace composition
```

These are dependency directions, not mandatory directories.

## 4.1 Design tokens

Use shared semantic tokens for known meanings such as:

- success;
- warning;
- danger;
- information;
- muted text/background;
- borders;
- surface levels;
- intentional provider identity colors.

Feature components should express meaning rather than recreate the palette.

Avoid raw one-off colors when an existing semantic token expresses the same concept.

## 4.2 Behavior primitives

Prefer proven accessible libraries for difficult interaction behavior.

For the current frontend stack:

```text
Radix = interaction/accessibility primitives
Tailwind + application tokens = styling
Application-owned wrappers = feature-facing UI API
```

Prefer existing wrappers for dialogs, sheets, menus, popovers, tooltips, and similar behavior.

Do not hand-roll focus trapping, Escape handling, portals, keyboard navigation, or modal background behavior when an established primitive already solves it.

## 4.3 One general interaction foundation

Do not mix multiple general-purpose UI frameworks that compete for the same responsibility without an explicit technical decision.

Focused libraries for editors, charts, virtualization, drag and drop, rich text, or data grids are fine when they solve a distinct problem.

---

# 5. Visual and orchestration boundaries

## 5.1 Visual components

A visual component should mostly:

- receive typed props;
- render UI;
- emit user intentions through callbacks;
- own local visual state where appropriate;
- avoid knowing how data is fetched or persisted.

## 5.2 Smart/container components and feature hooks

A smart layer may:

- fetch/query data;
- call mutations;
- coordinate navigation;
- own side effects;
- translate application/domain state into view props;
- compose several feature states;
- handle server errors.

Do not force a visual/container split for trivial components.

Separate these concerns when the combined component becomes harder to understand, test, or evolve.

## 5.3 Keep orchestration visible, not enormous

A page or feature entry component may legitimately coordinate several hooks and actions.

Its responsibility should be to make the feature flow understandable, not to contain the implementation of every subfeature.

If the orchestration itself becomes complex, group related behavior into feature hooks or use-case-style functions rather than moving all code into one generic hook.

---

# 6. Hooks and browser lifecycle

## 6.1 Extract hooks by behavior ownership

A hook is a good extraction candidate when it owns a coherent behavior such as:

- viewport/keyboard tracking;
- event subscription;
- polling;
- timers;
- drag/drop state;
- session lifecycle;
- coordinated mutations;
- synchronization with an external system.

Keep feature-specific hooks beside the feature.

Move a hook to a shared location only when several independent features genuinely reuse the behavior.

## 6.2 Do not use hooks as dumping grounds

A 300-line `useFeature()` hook containing all queries, mutations, timers, projection, navigation, and UI state merely moves the giant component problem.

Split hooks when they represent different lifecycles or responsibilities.

---

# 7. View models and data transformation

Keep significant data transformation out of JSX.

Prefer:

```text
raw events / API data
        ↓
projection / selector / view model
        ↓
visual components
```

Projection logic should normally be deterministic and independently testable.

Build view models close to the place where the source data is understood.

Do not create view models ceremonially for trivial prop mapping.

## 7.1 View-model boundaries should follow change boundaries

Group values that:

- come from the same logical source;
- change together;
- are expected to invalidate together.

Do not combine mostly-static metadata with high-frequency streaming state merely to reduce the number of props.

A view model should be the smallest coherent update unit useful to the consumer.

---

# 8. State ownership

Keep state as close as practical to the component or feature that owns it.

Prefer:

- local component state for local visual state;
- feature hooks for feature behavior;
- the existing query/cache layer for server state;
- shared/global state only when distant surfaces genuinely need the same client-side state.

Do not duplicate derived state.

Do not mirror query/props state into local state unless the local value intentionally represents a different lifecycle, such as an editable draft.

When several booleans model mutually exclusive states, prefer a discriminated state that prevents impossible combinations.

---

# 9. Effects and side effects

Use effects to synchronize React with external systems.

Do not use effects as a general event-processing or derived-state mechanism.

Inspect effects that:

- derive normal render state;
- parse large event streams;
- coordinate unrelated behaviors;
- update several state variables in sequence;
- require complex dependency suppression.

Prefer explicit event handlers, reducers, projections, selectors, or focused feature hooks.

Do not routinely suppress `exhaustive-deps` to preserve an awkward design.

---

# 10. Context and subscription boundaries

Context should not become a high-frequency global event bus.

Context boundaries should follow consumer and change boundaries.

Avoid one broad context combining:

- almost-static identity;
- rarely-changing permissions;
- frequent activity;
- streaming text;
- local input state.

Prefer narrower contexts, local state, or selector-based subscriptions when update frequency differs materially.

Do not split context mechanically into dozens of providers. Split when consumers or invalidation patterns are genuinely different.

---

# 11. Props and component contracts

Prefer small, meaningful contracts.

Pass a coherent domain/view concept when its values belong together and change together.

Do not pass giant application objects merely to avoid defining props.

Do not construct giant view-model objects from unrelated inputs merely to make a component signature shorter.

Props should make ownership clear.

---

# 12. Variants and reusable components

Use variants for genuine visual variants of the same semantic concept.

If variants begin to represent different product concepts or unrelated behavior, split the components.

Avoid premature abstractions such as:

```text
UniversalInfoPanel
GenericTimelineItem
FlexibleMetaBlock
```

unless real consumers demonstrate that the generic concept exists.

Build reusable semantics, not generic-looking names.

---

# 13. Render purity and identity

React rendering must be pure.

Do not during render:

- mutate external data;
- sort mutable props in place;
- create random identity;
- write to external caches;
- depend on the fact that rendering happened.

Use stable domain identifiers for keys.

Use `useId` for accessibility relationships, not list keys.

Treat `key` as a component identity boundary. Use it deliberately when local state should reset for a different entity.

## 13.1 Define component types statically

Do not define stateful React component types inside another component.

Small render helper functions are different, but a component with its own state, hooks, lifecycle, or visual responsibility should have stable module-level identity.

---

# 14. Accessibility

Accessibility is part of the primitive, not an afterthought.

Shared primitives should own behavior where possible:

- focus management;
- Escape handling;
- keyboard navigation;
- ARIA roles/states;
- accessible names;
- focus restoration;
- modal background behavior.

Use semantic HTML before custom ARIA.

Components used as primitive leaves or Radix `asChild` targets should correctly forward supported DOM props, events, `className`, `aria-*`, `data-*`, and refs according to the project React version.

---

# 15. Responsive behavior

Do not treat mobile as a CSS afterthought.

When implementing or refactoring:

- identify primary information;
- prefer progressive disclosure;
- avoid simply shrinking desktop controls;
- test narrow widths;
- test long content;
- test keyboard-open states.

Desktop and mobile may use different compositions over the same data/view model.

Do not duplicate domain or query logic solely because layout differs.

---

# 16. Styling

Prefer:

- existing Tailwind conventions;
- semantic design tokens;
- reusable class/variant helpers;
- shared component variants.

Avoid:

- scattered magic colors;
- arbitrary z-index values;
- repeated one-off shadows/borders;
- duplicated responsive breakpoints for the same concept;
- feature code controlling portal/z-index internals without a concrete reason.

Promote repeated semantic treatments into a shared token or component.

---

# 17. Loading, empty, and error states

Reuse shared states when semantics match.

A feature may compose shared primitives with feature-specific content and actions.

Do not create one universal state component with many unrelated flags.

Use Error Boundaries where a render failure needs a useful isolation/recovery boundary.

Do not wrap every small component in its own boundary.

---

# 18. Memoization and render performance

Memoization should follow good data boundaries, not compensate for poor ones.

Prefer this order:

1. define cohesive component and view-model boundaries;
2. keep state local;
3. preserve stable identities where practical;
4. remove unnecessary effects and cascading updates;
5. profile the actual interaction;
6. add targeted memoization or scheduling only if needed.

Do not add `memo`, `useMemo`, or `useCallback` mechanically.

Do not rely on memoization for correctness.

Do not adopt React Compiler as part of an unrelated refactor without an explicit technical decision.

---

# 19. Testing

Test logic at the level where it lives.

## Projection/view-model logic

Prefer unit tests for:

- event grouping;
- derived statuses;
- normalization;
- state transitions;
- deterministic projection.

## Visual components

Test user-observable behavior:

- visible content;
- accessibility state;
- callbacks;
- expand/collapse;
- disabled/loading states;
- keyboard interaction where relevant.

Prefer React Testing Library or the project's established equivalent for new component tests.

Do not introduce deprecated renderer-based approaches for new tests.

## Smart/orchestration code

Test:

- integration with query/mutation contracts;
- error handling;
- mapping into presentation props;
- relevant lifecycle behavior.

Avoid relying exclusively on broad snapshots.

---

# 20. Refactoring rule

When touching an oversized or mixed-responsibility feature:

- improve boundaries required by the touched behavior;
- extract independently behaving components and hooks;
- move meaningful data transformation out of JSX;
- reuse existing primitives;
- remove obsolete local implementations superseded by the refactor.

Do not perform unrelated repository-wide cleanup.

Do not preserve an obviously broken local boundary merely to minimize the diff.

A refactor should improve the code that the change actually depends on, not opportunistically redesign the whole frontend.

---

# 21. React linting as enforcement

Prefer mechanical enforcement for rules that tools can reliably verify.

Use the official React hooks lint rules where compatible with the repository.

Treat lint failures as design signals rather than routinely silencing them.

Architecture rules such as module responsibility and file decomposition remain review concerns and should not be reduced to crude LOC lint rules.

---

# 22. Review checklist

When creating or refactoring React UI, verify:

- [ ] Does each primary module have one clear responsibility?
- [ ] Can the page/feature be understood mostly from composition and orchestration?
- [ ] Are several independently stateful or lifecycle-owning components accumulating in one file?
- [ ] Could small private visual helpers reasonably stay local instead of creating unnecessary files?
- [ ] Does a feature directory exist only where the feature has real internal structure?
- [ ] Are feature-specific hooks/view models kept feature-local?
- [ ] Is file size being used as a review signal rather than an automatic split rule?
- [ ] Is significant raw-data transformation kept out of JSX?
- [ ] Are visual and orchestration concerns separated where complexity warrants it?
- [ ] Did we search for an existing shared primitive/component first?
- [ ] Are semantic tokens reused instead of raw one-off colors?
- [ ] Is difficult interaction behavior implemented through the established primitive system?
- [ ] Is state owned at the narrowest sensible level?
- [ ] Is derived or persisted state duplicated unnecessarily?
- [ ] Are effects used for genuine synchronization?
- [ ] Do context/view-model boundaries follow update boundaries?
- [ ] Are list keys stable and derived from data?
- [ ] Are component types defined statically?
- [ ] Are accessibility and keyboard behavior covered?
- [ ] Does the feature behave correctly on narrow/mobile layouts?
- [ ] Are tests located at the responsibility they verify?
- [ ] Are memoization and performance mechanisms justified by real behavior?
- [ ] Did the refactor avoid unrelated cleanup and premature generic abstractions?

---

# 23. Preferred frontend stack direction

Unless explicitly revised by an architecture decision:

```text
React
  +
Tailwind / semantic design tokens
  +
application-owned UI components/primitives
  +
Radix Primitives for complex accessible interaction behavior
```

Do not introduce another competing general-purpose component/primitive framework without an explicit technical decision.

Specialized libraries remain acceptable when they solve a distinct capability.
