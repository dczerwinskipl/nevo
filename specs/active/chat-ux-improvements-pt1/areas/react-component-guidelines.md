---
id: chat-ux-improvements-pt1.react-component-guidelines
type: area
change: chat-ux-improvements-pt1
---

# Area: React component guidelines

## Responsibility

Cross-cutting engineering conventions for how React UI code in this change is
structured — component sizing/composition, the token → primitive → wrapper → feature
layering, state/effect/context boundaries, memoization discipline, and accessibility
baseline. Unlike the other areas in this change, this is not an independently
implementable unit of work with its own acceptance criteria — it is required reading
for every task that creates or restructures React components in
`tools/dashboard/src`, so that the eleven tasks in this change (each touching
overlapping parts of the same component tree) converge on one consistent shape instead
of eleven locally-reasonable ones.

## Current state

Not applicable — this is guidance, not a description of existing behavior. Discovery
evidence about the *current* component tree lives in `overview.md` and each task's own
`context.required` citations.

## Requirements

Owner-provided guide, reproduced in full below. Treat it as always-read guidance for
this change's frontend tasks, in particular:

- Task 06 (`shared-session-details`) building the new `Sheet`/`Dialog` primitive (§2.2,
  §2.3, §3, §14, §25) — this is the task most directly bound by the "Nevo-owned
  wrapper around Radix, not a direct Radix import in feature code" rule.
- Task 01 (`semantic-chat-presentation-model`) defining the Work/Conversation
  projection (§6, §9, §23.1) — projection must live outside JSX, and the resulting
  view-model's update boundaries should follow §9.1's cohesive-change-frequency rule
  (e.g. session identity vs. streaming Work state must not be forced into one object
  that both a static header and a per-token stream consumer subscribe to identically).
- Tasks 02-04 (message/Work/tool rendering), 08 (streaming/scroll) — §20, §21, §23 apply
  directly to list rendering (stable `message.id`/`toolId` keys, no index keys, no
  render-time identity generation) and to avoiding unnecessary re-renders on every
  streamed token.
- Task 09 (session states) — reuses `ux-improvements-version-1`'s
  `shared-status-label-component` per §4 ("search for an existing shared primitive ...
  before creating") rather than a chat-local status treatment.

---

<!-- Full guide follows, owner-provided verbatim. -->

# React Component Guidelines

## Purpose

This document defines the preferred way to structure React UI code in Nevo.

It should be treated as **always-read guidance for frontend implementation and refactoring**, especially when:

- creating or restructuring React components;
- changing shared UI;
- introducing dialogs, drawers, menus, tooltips or other interactive primitives;
- extracting reusable components;
- changing styling or status/color presentation;
- refactoring large feature components.

The goal is not to enforce arbitrary purity. The goal is to keep the UI easy to understand, compose, reuse, test and evolve.

---

# 1. Core principles

## 1.1 Prefer small, focused components

A component should have one clear responsibility.

Good reasons to split a component:

- it renders a distinct visual concept;
- it owns a distinct interaction;
- it can be reused;
- it contains logic that obscures the parent component;
- it changes for a different reason than the rest of the parent;
- extracting it makes the main composition substantially easier to read.

Do not split components solely to satisfy a line-count rule.

Prefer:

```tsx
<ChatHeader />
<Conversation />
<WorkSummary />
<Composer />
```

over one large component containing all layout, fetching, event projection, interaction state and markup.

A page or feature component should read primarily as **composition**, not as hundreds of lines of implementation detail.

---

## 1.2 Prefer composition over configuration-heavy components

Prefer composing focused parts using `children`, slots or small subcomponents.

Prefer:

```tsx
<SessionDetails>
  <SessionContext />
  <SessionActions />
</SessionDetails>
```

over:

```tsx
<SessionDetails
  showProvider
  showMode
  showTasks
  allowDelete
  allowChangeSpec
  compact={false}
  mobileVariant="drawer"
  desktopVariant="dialog"
/>
```

Avoid components that accumulate many booleans to represent unrelated layouts or responsibilities.

If a component needs many independent flags, consider whether it should instead expose composable pieces.

---

# 2. UI architecture

Use the following conceptual layers.

```text
Design tokens
    ↓
Behavior primitives
    ↓
Nevo UI primitives
    ↓
Reusable visual components
    ↓
Feature components
    ↓
Smart/container components and feature hooks
    ↓
Pages / workspace composition
```

The layers are guidelines, not mandatory directories, but dependencies should generally flow downward.

---

## 2.1 Design tokens

Use shared semantic design tokens for known concepts.

Examples:

- success;
- warning;
- danger;
- information;
- muted text/background;
- borders;
- surface levels;
- provider identity colors where intentionally part of the product system.

Do not introduce raw one-off colors inside feature components when an existing semantic token expresses the same meaning.

Avoid:

```tsx
className="text-amber-500 bg-amber-950"
```

when the meaning is actually `warning` and the design system already provides a warning treatment.

Feature components should express **meaning**, not recreate the palette.

Raw colors are acceptable only when the color itself is the product data or when no semantic token exists and adding one is justified.

---

## 2.2 Behavior primitives

Prefer proven accessible libraries for difficult interaction behavior instead of repeatedly implementing it manually.

For Nevo, the preferred direction is:

- **Radix Primitives** for accessible interactive behavior;
- existing Nevo/Tailwind design tokens and classes for appearance.

Examples:

- Dialog / modal → Radix Dialog;
- Sheet / drawer → Nevo `Sheet` built on Radix Dialog;
- destructive confirmation → Radix Alert Dialog;
- dropdown menu → Radix Dropdown Menu;
- tooltip → Radix Tooltip;
- popover → Radix Popover;
- collapsible/accordion → Radix Collapsible or Accordion when appropriate.

Do not hand-roll focus trapping, Escape handling, portal behavior or keyboard navigation when a stable primitive already solves it.

---

## 2.3 One interaction foundation

Do not mix multiple general-purpose UI frameworks that compete for responsibility.

For example, avoid combining:

- Radix as one primitive system;
- MUI as another component system;
- Headless UI as a third;
- custom modal/menu implementations alongside both.

Technically these libraries can coexist, but doing so creates:

- inconsistent accessibility behavior;
- competing theme systems;
- different interaction conventions;
- duplicated abstractions;
- unclear ownership of primitives;
- larger dependency surface.

The preferred Nevo model is:

```text
Radix = interaction/accessibility primitives
Tailwind + Nevo tokens = styling
Nevo wrappers = application-facing UI API
```

Specialized libraries are still fine when they solve a different problem, for example charts, editors or virtualization. The rule is against multiple competing **general UI primitive systems**, not against dependencies in general.

---

# 3. Nevo-owned UI primitives

Feature code should normally consume Nevo-owned wrappers rather than importing Radix directly.

Prefer:

```tsx
import {
  Sheet,
  SheetContent,
  SheetHeader,
} from "@/components/ui/sheet";
```

instead of:

```tsx
import * as Dialog from "@radix-ui/react-dialog";
```

throughout feature code.

The wrapper owns:

- Nevo styling;
- semantic tokens;
- spacing;
- default accessibility behavior;
- animations;
- portal/z-index policy;
- reusable variants.

Example:

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button variant="ghost" aria-label="Session details">
      <InfoIcon />
    </Button>
  </SheetTrigger>

  <SheetContent side="right">
    <SessionDetails />
  </SheetContent>
</Sheet>
```

Radix remains an implementation detail of the shared primitive.

This keeps feature code independent from a specific library and prevents different features from configuring the same primitive differently.

---

# 4. Reuse before creating

Before creating a component or primitive:

1. search for an existing shared primitive;
2. search for an existing component representing the same visual concept;
3. search for an existing semantic token/variant;
4. extend the existing abstraction if the new requirement belongs to the same concept;
5. create a new abstraction only when the concept is genuinely different.

Do not duplicate:

- status badges;
- warning/success treatments;
- modal shells;
- empty/loading/error states;
- icon buttons;
- provider labels;
- repeated card structures;
- common form controls.

At the same time, do not force unrelated concepts into one "universal" component solely to maximize reuse.

Reuse should follow semantic similarity, not visual coincidence.

---

# 5. Visual and smart components

Prefer separating presentation from orchestration when a component becomes non-trivial.

## 5.1 Visual/presentational component

A visual component should mostly:

- receive typed props;
- render UI;
- emit user intentions through callbacks;
- contain local visual state when appropriate;
- avoid knowing how data is fetched or persisted.

Example:

```tsx
type SessionDetailsProps = {
  spec?: SpecSummary;
  tasks: TaskSummary[];
  provider: string;
  mode: AgentMode;
  onDelete: () => void;
};

export function SessionDetails(props: SessionDetailsProps) {
  return (
    // presentation
  );
}
```

---

## 5.2 Smart/container component or hook

A smart layer may:

- fetch/query data;
- call mutations;
- translate domain/application state into view props;
- coordinate navigation;
- own side effects;
- handle server errors;
- compose several feature states.

Example:

```tsx
function SessionDetailsContainer({ sessionId }: Props) {
  const session = useAgentSession(sessionId);
  const deleteSession = useDeleteAgentSession();

  return (
    <SessionDetails
      spec={session.spec}
      tasks={session.tasks}
      provider={session.provider}
      mode={session.mode}
      onDelete={() => deleteSession.mutate(sessionId)}
    />
  );
}
```

This makes the visual component easy to:

- understand;
- test;
- reuse;
- render in Storybook/test fixtures if introduced later.

---

## 5.3 Do not force the split for trivial components

Avoid ceremonial wrappers.

This is fine:

```tsx
function StatusDot({ status }: Props) {
  return <span className={statusClass(status)} />;
}
```

Do not create `StatusDotContainer`, `useStatusDotModel` and `StatusDotView` without an actual reason.

Separate smart and visual concerns when complexity benefits from it.

---

# 6. Keep data transformation out of JSX

Do not make a rendering component understand a large raw event protocol.

Avoid:

```tsx
events.map(event => {
  if (event.type === "tool.started") ...
  if (event.type === "tool.updated") ...
  if (event.type === "assistant.message") ...
  if (event.type === "turn.failed") ...
});
```

spread throughout a large component.

Prefer:

```text
raw events
    ↓
projection / view model
    ↓
small visual components
```

Example:

```ts
const chat = projectChatEvents(events);

return (
  <Conversation>
    {chat.turns.map(turn => (
      <ChatTurn key={turn.id} turn={turn} />
    ))}
  </Conversation>
);
```

Projection logic should be deterministic and independently testable.

---

# 7. State ownership

Keep state as close as practical to the component that owns the interaction.

Prefer:

- local component state for purely local visual state;
- feature hooks for feature-level behavior;
- existing query/cache solution for server state;
- shared/global state only when multiple distant surfaces genuinely need the same client-side state.

Do not duplicate derived state.

Avoid:

```tsx
const [completedCount, setCompletedCount] = useState(...);
```

when `completedCount` can be derived reliably from the current Work model.

Prefer:

```ts
const completedCount = work.completed.length;
```

---

# 8. Effects and side effects

Use effects for synchronizing React with external systems, not as a general event-processing mechanism.

Avoid large effects that:

- derive normal render state;
- parse event streams;
- coordinate several unrelated behaviors;
- update multiple pieces of state in sequence.

Prefer explicit functions, reducers, projection functions or feature hooks.

If an effect needs a long explanatory comment to justify dependency behavior, inspect whether the responsibility belongs elsewhere.

---

# 9. Props and contracts

Prefer small, meaningful contracts.

Pass domain/view concepts rather than a collection of unrelated primitives **when those values form one coherent unit and change together from the same underlying data**.

Prefer:

```tsx
<WorkSummary work={work} />
```

over:

```tsx
<WorkSummary
  currentToolName={...}
  currentToolStatus={...}
  completedCount={...}
  failedCount={...}
  toolDescription={...}
  output={...}
/>
```

when those values are derived from the same Work state and normally change as one view-model snapshot.

## 9.1 View-model boundaries should follow change boundaries

Do not build one large view model from several unrelated inputs that have very different update frequencies only to make the component signature look cleaner.

Example of a poor boundary:

```ts
const chatHeaderVm = {
  sessionTitle,          // almost static
  provider,              // almost static
  mode,                  // changes occasionally
  streamingTokenCount,   // changes constantly
  currentActivity,       // changes often
};
```

If that object is recreated on every streaming update, every consumer of `chatHeaderVm` sees a new reference even when most of the data it cares about did not change.

That makes effective memoization harder and can cause unnecessary rendering.

Prefer view models whose fields:

- come from the same logical source or projection;
- have similar change frequency;
- are expected to invalidate together.

If data changes at materially different rates, split the boundary.

For example:

```tsx
<ChatHeader
  session={sessionHeader}
  status={sessionStatus}
/>
```

or compose smaller children:

```tsx
<ChatHeader>
  <SessionIdentity value={sessionIdentity} />
  <SessionStatus value={sessionStatus} />
</ChatHeader>
```

where `sessionIdentity` may remain referentially stable while `sessionStatus` updates during streaming.

The goal is not to maximize the number of props. The goal is to define **cohesive update units**.

## 9.2 Build view models close to their data source

Prefer producing a view model from one source/projection/selectable state rather than assembling it inside a visual component from many independent props.

Good:

```ts
const work = selectWorkViewModel(turnState);
```

then:

```tsx
<WorkSummary work={work} />
```

Less desirable:

```tsx
<WorkSummary
  tool={tool}
  status={status}
  output={output}
  errors={errors}
/>
```

followed by reconstructing a `work` object inside the component.

The view model should normally be created where its source data is understood, so:

- normalization happens once;
- memoization/selectors can work effectively;
- visual components receive stable, coherent contracts;
- presentation does not need to rebuild domain/view state on every render.

However, do not pass giant application objects merely to avoid defining props.

A visual component should receive the smallest **coherent and memoization-friendly** model it needs.

---

# 10. Variants

Use variants for genuine visual variants of the same concept.

Good:

```tsx
<Button variant="destructive" />
<StatusLabel tone="warning" />
```

Poor:

```tsx
<Card
  isChat
  isTask
  isCompact
  isInteractive
  useStrongBorder
  showFooter
/>
```

When variants begin representing different concepts, split the components.

---

# 11. Accessibility is part of the primitive

Accessibility should not be added at the end.

Shared primitives should own correct behavior where possible:

- focus management;
- Escape handling;
- keyboard navigation;
- ARIA roles/states;
- accessible names;
- focus restoration;
- modal background behavior.

Feature components still own semantic labels and correct content.

Use semantic HTML before custom ARIA.

---

# 12. Responsive design

Do not treat mobile as a CSS afterthought.

When implementing/refactoring:

- decide what information is primary;
- remove persistent chrome that does not deserve viewport space;
- prefer progressive disclosure;
- avoid simply shrinking desktop controls;
- test keyboard-open states;
- test long content;
- test narrow widths.

Desktop and mobile may use different compositions over the same view model.

Avoid duplicating domain/query logic solely because layout differs.

---

# 13. Styling rules

Prefer:

- existing Tailwind conventions;
- semantic design tokens;
- existing reusable class/variant helpers;
- shared component variants.

Avoid:

- scattered magic colors;
- arbitrary z-index values;
- repeated one-off shadows/borders;
- duplicated responsive breakpoints for the same concept;
- inline style objects without a concrete reason.

If several features need the same treatment, promote it into a shared token/component.

---

# 14. Z-index and overlays

Overlay primitives should follow one shared policy.

Do not allow every modal/drawer/popover to invent:

```css
z-[9999]
```

Shared Dialog/Sheet/Popover/Menu primitives should define the layer strategy.

Feature code should not normally control portal or z-index internals.

---

# 15. Error/loading/empty states

Prefer reusable states when semantics match.

Examples:

```tsx
<LoadingState />
<EmptyState />
<ErrorState />
```

but do not make one universal component with dozens of flags.

A feature may compose shared primitives with feature-specific copy/actions.

---

# 16. Testing guidance

Test logic at the level where it lives.

## Projection/view-model logic

Prefer unit tests for:

- event grouping;
- derived statuses;
- normalized labels;
- state transitions.

## Visual components

Test:

- visible content;
- accessibility state;
- callbacks;
- expand/collapse;
- disabled/loading variants.

## Smart/container components

Test:

- integration with query/mutation contracts;
- error handling;
- correct mapping into presentation props.

Avoid relying exclusively on large snapshots.

For new React component tests, prefer user-observable testing through React Testing Library (or the project's existing equivalent). Do not introduce `react-test-renderer` for new tests; it is deprecated in React 19.

---

# 17. Refactoring rule: improve boundaries while touching code

When a refactor touches an oversized or mixed-responsibility component:

- do not preserve poor boundaries solely to minimize the diff;
- extract reusable primitives/components where the new design clearly requires them;
- move event/data transformation out of visual JSX;
- remove dead branches and obsolete presentation paths;
- reuse existing shared primitives instead of adding another local version.

Do not perform unrelated broad cleanup, but do not knowingly build the new feature on top of an obviously broken local abstraction.

---

# 18. Avoid premature generic abstractions

Do not create a generic abstraction before there is a clear shared concept.

Prefer:

```text
SessionDetails
WorkSummary
StatusLabel
```

over:

```text
UniversalInfoPanel
GenericTimelineItem
FlexibleMetaBlock
```

unless multiple real consumers prove the generic concept.

Build reusable semantics, not generic-looking names.

---

# 19. Feature code should read like the product

Prefer composition that communicates the UX:

```tsx
<ChatLayout>
  <ChatHeader />
  <Conversation>
    <ChatTurn>
      <AssistantMessage />
      <WorkSummary />
    </ChatTurn>
  </Conversation>
  <Composer />
</ChatLayout>
```

The main feature component should make the product structure obvious.

If understanding the screen requires reading 500 lines of conditional JSX, the decomposition is probably wrong.

---

# 20. Render purity and component identity

React rendering must be pure.

A component should calculate UI from its current props, state and context. Rendering should not mutate external state or create values whose meaning depends on the act of rendering itself.

Avoid during render:

```tsx
const id = crypto.randomUUID();
const now = Date.now();
props.items.sort();
externalCache.set(key, value);
```

when those operations change identity, mutate shared data or make the same inputs produce different output.

Prefer:
- IDs from domain data;
- `useId` for accessibility relationships;
- event handlers for user-triggered side effects;
- Effects only for synchronization with external systems;
- immutable updates.

## 20.1 Define component types statically

Do not define React component types inside another component unless there is an exceptional, documented reason.

Avoid:

```tsx
function Chat() {
  function Message() {
    return <div>...</div>;
  }

  return <Message />;
}
```

A nested component type is recreated when the parent renders. That can cause unnecessary remounting and state loss.

Prefer module-level component definitions:

```tsx
function Message() {
  return <div>...</div>;
}

function Chat() {
  return <Message />;
}
```

Small render helper functions that return fragments of JSX are a separate choice, but if something has its own state, hooks, lifecycle or reusable visual responsibility, make it a real stable component.

---

# 21. Identity, keys and state lifetime

Treat React `key` as an identity boundary, not as a warning-suppression mechanism.

## 21.1 Stable list keys

For messages, sessions, Work items, tasks and other dynamic collections:

- use a stable identifier from the data;
- do not use array index when items can be inserted, removed or reordered;
- do not generate keys during rendering;
- never use `Math.random()` or a new UUID as a render-time key.

Good:

```tsx
{messages.map(message => (
  <Message key={message.id} message={message} />
))}
```

Poor:

```tsx
{messages.map((message, index) => (
  <Message key={index} message={message} />
))}
```

for a live/streaming list whose contents may change.

Stable keys preserve the correct component state, DOM and interaction state across updates.

## 21.2 Use keys deliberately to reset state

Keys may intentionally define when local state belongs to a different entity.

Example:

```tsx
<Composer key={sessionId} sessionId={sessionId} />
```

may be appropriate if a composer draft must be reset when switching to another session.

Do not reset state indirectly through synchronization Effects if entity identity already provides the correct boundary.

Before adding reset logic, decide explicitly:

- should state survive this entity change?
- or is this a new component identity?

---

# 22. Context and subscription boundaries

Context is useful for low-friction dependency distribution, but it should not become a high-frequency global event bus.

React re-renders consumers when the context value changes. `memo` does not prevent a component from receiving a new context value.

Therefore, context boundaries should follow **change boundaries**, just like view models.

Avoid one context such as:

```ts
type ChatContextValue = {
  sessionIdentity: SessionIdentity; // almost static
  permissions: Permissions;         // rarely changes
  currentActivity: Activity;        // changes frequently
  streamedText: string;             // changes constantly
  composerDraft: string;            // changes while typing
};
```

if all consumers receive a new context value on every streaming update.

Prefer:
- separate contexts for genuinely separate concerns;
- local state when state is local;
- selectors/subscriptions to the smallest required slice when using an external store;
- stable context values where the underlying data did not change.

Example direction:

```text
SessionIdentityContext    -> low-frequency session metadata
SessionActionsContext     -> stable actions
Streaming/work state      -> narrow feature subscription / props / selector
Composer draft            -> local composer state
```

Do not split contexts mechanically into dozens of tiny providers. Split them when consumers and update frequency differ materially.

---

# 23. Memoization and render-performance strategy

Memoization should follow good data boundaries, not compensate for poor ones.

Use this order:

1. design cohesive component/view-model/update boundaries;
2. keep state local;
3. preserve stable identities for unchanged data where practical;
4. remove unnecessary Effects and cascading updates;
5. profile an actual slow interaction;
6. then add targeted memoization or scheduling if still needed.

## 23.1 Preserve references for unchanged update units

When a projection or selector returns structured data, avoid rebuilding unrelated submodels when only one small part changed.

For example, a streaming token should not require recreating stable session metadata objects if their data is unchanged.

Conceptually:

```ts
{
  identity,       // stable reference
  associations,   // stable until tasks/spec change
  currentTurn,    // changes during stream
}
```

is easier to optimize than reconstructing one giant object graph on every event.

This is especially important for:
- streaming chats;
- large lists;
- context values;
- memoized children;
- selector-based stores.

## 23.2 Do not memoize everything by default

Do not add `memo`, `useMemo` and `useCallback` mechanically.

Manual memoization is useful when:
- a component is measurably expensive;
- it frequently receives unchanged props;
- preserving a value/function identity matters to another optimized boundary;
- profiling shows a real benefit.

Do not rely on memoization for correctness.

Avoid custom deep `arePropsEqual` comparators except for a very constrained, measured case. A deep comparison can cost more than rendering and becomes fragile as data evolves.

## 23.3 React Compiler

Modern React can use React Compiler to automatically memoize components, values and functions.

If Nevo adopts React Compiler:
- do not retain manual memoization merely out of habit;
- let compiler diagnostics influence cleanup;
- verify optimization with React DevTools when performance matters.

Do **not** adopt React Compiler solely as part of an unrelated UI refactor without an explicit technical decision.

Even with the compiler, good change boundaries still matter:
- broad context invalidation still changes consumers;
- external subscriptions still need sensible selectors;
- rebuilding unnecessary domain/view structures still increases work outside React rendering.

## 23.4 Non-blocking rendering is an escalation tool

If profiling shows that a large non-critical render blocks input or interaction, consider React scheduling primitives such as:
- `useDeferredValue`;
- `useTransition`.

Do not use transitions for controlled text-input state itself. Input state must stay responsive and synchronous.

Use scheduling only after fixing avoidable render work first.

---

# 24. Controlled state and source of truth

A piece of state should have one clear owner.

Avoid maintaining two synchronized copies of the same information.

Examples to avoid:

```tsx
const { data: session } = useSession(id);
const [localSession, setLocalSession] = useState(session);

useEffect(() => {
  setLocalSession(session);
}, [session]);
```

unless the local copy deliberately represents an editable draft/snapshot with different lifecycle semantics.

Prefer:
- query/server state as the source of truth for persisted data;
- local state for unsaved UI state;
- explicit draft models when the user is editing something before commit;
- derived values calculated from existing state instead of duplicated state.

## 24.1 Avoid impossible UI states

When several booleans describe one state machine, prefer a discriminated state when combinations can become invalid.

Avoid:

```ts
{
  isLoading: true,
  isFailed: true,
  isCompleted: true
}
```

when those states are mutually exclusive.

Prefer:

```ts
type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Data }
  | { kind: "failed"; error: Error };
```

Do not create a state machine where independent booleans genuinely represent independent dimensions. Use this pattern when it prevents invalid combinations.

---

# 25. Leaf-component contract and Radix composition

Components intended to be used as UI primitives or as children of Radix `asChild` must behave like transparent, semantic leaf components.

They should:
- spread supported DOM props onto the underlying interactive element;
- preserve event handlers supplied by the primitive;
- accept/pass through `className`;
- accept/pass through `aria-*` and `data-*` attributes;
- expose/pass through the underlying ref using the project's React-version convention;
- render the correct semantic element by default.

Example:

```tsx
function Button({
  ref,
  className,
  ...props
}: React.ComponentPropsWithRef<"button">) {
  return (
    <button
      ref={ref}
      className={cn(buttonStyles(), className)}
      {...props}
    />
  );
}
```

For React versions/patterns where `forwardRef` is still required by an existing dependency or compatibility layer, use it there. New React 19 code can receive `ref` as a prop.

Do not use `asChild` to turn an accessible interactive control into an inaccessible `div`.

Prefer native semantics:

```tsx
<button />
<a href="..." />
<input />
```

and use Radix to provide behavior that native HTML alone does not provide cleanly.

A Nevo wrapper should hide library-specific configuration from feature code where practical.

---

# 26. IDs and accessibility relationships

Use `useId` when a reusable component needs unique IDs to connect accessibility attributes such as:

- `htmlFor`;
- `aria-describedby`;
- `aria-labelledby`.

Example:

```tsx
const hintId = useId();

return (
  <>
    <input aria-describedby={hintId} />
    <p id={hintId}>...</p>
  </>
);
```

Do not use `useId` for list keys. List identity must come from the data.

---

# 27. React linting as architecture enforcement

Prefer enforcing React rules mechanically rather than relying only on review memory.

Use the official `eslint-plugin-react-hooks` recommended configuration where compatible with the repository.

Relevant rules include:
- `rules-of-hooks`;
- `exhaustive-deps`;
- `purity`;
- `immutability`;
- `refs`;
- `static-components`;
- `set-state-in-effect`;
- `set-state-in-render`;
- compiler-related diagnostics when applicable.

Treat lint failures as signals to inspect the design.

Do not routinely silence `exhaustive-deps` or other React rules with disable comments just to make lint pass.

If an existing codebase has many violations:
- adopt/fix incrementally;
- keep explicit follow-ups for legacy violations;
- do not weaken new/refactored code to match the legacy pattern.

---

# 28. Error boundaries

Use Error Boundaries for render failures that need UI isolation.

Do not expect `try/catch` around JSX in a parent render to catch errors thrown while rendering descendants.

Consider local boundaries around genuinely failure-prone or optional surfaces when one failure should not destroy the entire workspace, for example:
- rich markdown/rendering plugins;
- code preview/viewers;
- independently loaded panels.

Do not wrap every tiny component in its own boundary.

The boundary should correspond to a useful recovery/isolation unit.

---

# 29. Review checklist

When creating or refactoring React UI, verify:

- [ ] Does the component have one clear responsibility?
- [ ] Can the main feature/page be understood mostly from composition?
- [ ] Is any large raw-data transformation still happening inside JSX?
- [ ] Are visual and orchestration concerns separated where complexity warrants it?
- [ ] Did we search for an existing shared primitive/component first?
- [ ] Are semantic design tokens reused instead of raw colors?
- [ ] Are status/color conventions consistent with existing shared components?
- [ ] Is a difficult interaction being hand-rolled even though the chosen primitive library already solves it?
- [ ] Does feature code depend on Nevo wrappers rather than directly on Radix where a wrapper exists?
- [ ] Are we accidentally introducing another general-purpose UI framework?
- [ ] Is state owned at the narrowest sensible level?
- [ ] Is derived state being duplicated?
- [ ] Are effects being used only where synchronization/side effects are genuinely needed?
- [ ] Are accessibility and keyboard behavior covered?
- [ ] Does the component behave well on narrow mobile widths?
- [ ] Are long content and loading/error states handled?
- [ ] Are reusable interaction patterns implemented once?
- [ ] Are tests focused on projection/behavior instead of only snapshots?
- [ ] Did the refactor remove obsolete local implementations it supersedes?
- [ ] Did we avoid unrelated cleanup and premature generic abstractions?
- [ ] Are dynamic list keys stable and derived from data?
- [ ] Are component types defined statically rather than inside frequently rendered parents?
- [ ] Does local state have one clear source of truth rather than mirroring props/query data?
- [ ] Do Context boundaries avoid coupling high-frequency streaming state to mostly-static consumers?
- [ ] Do view-model/reference boundaries preserve unchanged update units where practical?
- [ ] Are `memo` / `useMemo` / `useCallback` justified rather than applied mechanically?
- [ ] Are Radix-compatible leaf components spreading props and passing refs correctly?
- [ ] Are native semantic elements preserved when composing primitives?
- [ ] Are React lint rules being fixed rather than routinely suppressed?

---

# 30. Preferred Nevo UI stack direction

Unless explicitly revised by architecture decisions:

```text
React
  +
Tailwind / Nevo semantic design tokens
  +
Nevo-owned UI components/primitives
  +
Radix Primitives for complex accessible interaction behavior
```

Do not introduce MUI, Chakra, Headless UI, Ant Design or another general-purpose component/primitive system alongside this stack without an explicit architectural decision.

This does not prohibit focused libraries for specialized capabilities such as:
- code editors;
- charts;
- virtualization;
- drag and drop;
- rich text;
- data grids when genuinely required.

The rule is to maintain one coherent ownership model for the general UI system.

## Area-specific acceptance criteria

Not applicable in the usual testable sense — this area is guidance consumed by other
tasks' own acceptance criteria and code review, not an implementation unit with its own
build/test target.

## Dependencies

None — this area has no implementation dependencies. Tasks 01-11 depend on *reading*
it (see each task's `context.required`), not the reverse.

## Out of scope

- Adopting React Compiler (§23.3) — explicitly flagged as requiring its own decision,
  not something this change adopts incidentally.
- Introducing `eslint-plugin-react-hooks` tooling changes (§27) — a tooling/CI change,
  out of this UX change's scope unless a separate task is created for it.
