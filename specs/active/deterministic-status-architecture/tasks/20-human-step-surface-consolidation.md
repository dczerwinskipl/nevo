---
id: deterministic-status-architecture.human-step-surface-consolidation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/human-step-surface.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/shared/workflow/human-step-surface.tsx
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/dashboard/ui/features/specifications/tasks/human-step-mutations.ts
  - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar-helpers.ts
  - tools/dashboard/ui/features/agent-sessions/human-step-mutations.ts
  - tools/dashboard/tests/**
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/shared/lib/human-step-request.ts
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - src/**
depends_on: [ dashboard-deterministic-action-projection, dashboard-human-step-transport, task-card-lifecycle-split, session-bootstrap-readiness-wiring ]
semantic_references:
  decisions: [D7, D11, D15, D17, D18, D19, D20]
---

# Task: Human step surface consolidation

## Goal

Build one reusable, **feature-neutral** `HumanStepSurface` (D11 — generic naming, not
`human-review-surface`; D17 — lives in `shared/workflow/`, prop-driven, not in either
consuming feature), scoped to the **active human interaction only** (D19/D20 — the generic
waiting-step "Start" control that works identically for both executors is a separate,
smaller mechanism owned by `specification-detail-composition-wiring`'s dispatcher/this
task's own `TaskDialog` wiring, not part of `HumanStepSurface` itself), and render it
directly from both
`TaskDialog` (`features/specifications`) and the existing chat surface
(`features/agent-sessions`) — replacing chat's current separate Approve/Request-changes/
`start-review` implementation, per D7 (shared component, not a chat→dialog redirect) — with
each feature owning its own thin adapter hook that calls the shared transport function
(D14/D17) for the surface's actions, never the legacy `/workflow/human-decision` route. This
task also owns: **defining** (not consuming — its real implementation is supplied later by
`specification-detail-composition-wiring`) the `onStartStep(stepDescriptor)` prop contract
`TaskDialog` accepts and calls, so a waiting step — either executor — has a working generic
Start control in the dialog, not only on the board; and, in `agent-session-page.tsx` (also
owned by this task, corrected per the seventh, strictly mechanical pass — previously
misassigned to `session-bootstrap-readiness-wiring`), renaming `handleStartReviewTask` to a
generic agent-step handler built on top of that task's pure `buildAgentStepTriggerMessage`
primitive, and migrating the chat surface's obsolete
`'start-review'`/`'approve'`/`'request-changes'` literal-action-id rendering block to the
generic model (D19).

## Dependencies

`dashboard-deterministic-action-projection` — this task's rendering reads the corrected
action DTO (tier-1/tier-2 descriptors, generic `availableActions`).
`dashboard-human-step-transport` — provides the neutral `shared/lib/human-step-request.ts`
function each feature's own adapter hook (built by this task) calls to reach
`startHumanStep`/`submitHumanStepResult`; the UI cannot call those server-side functions
directly, only through that shared function's HTTP requests. `task-card-lifecycle-split` —
reuse its deterministic action sub-component(s) where the action set genuinely overlaps
(within `features/specifications` only — that sub-component is feature-local, not moved to
`shared/`). `session-bootstrap-readiness-wiring` — owns the frontend `types.ts` DTO type
(D18) this task's `TaskDialog`/chat changes are authored against, and owns the pure
`buildAgentStepTriggerMessage` primitive (D19) this task's `agent-session-page.tsx` handler
calls to produce its generic trigger text — this task does **not** own or consume any
`onStartStep` *implementation* from that task (there isn't one yet); this task only
**defines** the `onStartStep` contract `TaskDialog` accepts, and owns
`agent-session-page.tsx`'s own handler rename/prop wiring to the chat surface entirely
itself (corrected per the seventh, strictly mechanical pass — `agent-session-page.tsx` was
previously, incorrectly, assigned to `session-bootstrap-readiness-wiring`).

## Implementation constraints

- **Build `HumanStepSurface` at `tools/dashboard/ui/shared/workflow/human-step-surface.tsx`,
  scoped to the active human interaction only (D19/D20 — narrower than pass 3/4/5's version
  of this component):** purely presentational, driven entirely by props
  (`{ interaction, loading, error, onSubmit }`) — no `stepDescriptor`/`onStart`. It renders
  one button/control per `interaction.actions` entry (`label`/`feedbackRequired`, `result`
  present only when conditional — D16, item 7) and calls `onSubmit(result?, feedback?,
  artifacts?)` for the chosen one — omitting `result` entirely for a single unconditional
  transition, never fabricating a placeholder value. It imports only from `shared/ui`/
  `shared/lib` — **never** `features/specifications`, `features/agent-sessions`,
  `screens/**`, or `routes/**`; it never fetches, never constructs a route URL, and never
  hardcodes `'approve'`/`'request-changes'` or a literal step id. The generic
  waiting-for-step-start UI (step descriptor + "Start" control, identical for both
  executors, D15) is a **separate** small piece of markup each call site (`TaskCard`,
  `TaskDialog`, chat) renders itself, calling its own `onStartStep`/`onStartAgentStep`/
  feature-local `start` — it is not part of `HumanStepSurface`, so no caller ever needs a
  second, unused `onStart` prop on the active-interaction component.
- Build two thin, feature-local adapter hooks — `features/specifications/tasks/human-step-mutations.ts`
  and `features/agent-sessions/human-step-mutations.ts` — each wrapping the shared
  `human-step-request.ts` function (`dashboard-human-step-transport`) in that feature's own
  `useMutation` (cache invalidation, loading/error state); `features/agent-sessions`'s hook
  additionally exposes a `start` method chat's own generic waiting-step control calls
  directly (chat never needs composition-layer indirection, since it already lives inside
  `features/agent-sessions` and never crosses into `features/specifications`); each hook
  provides the `onSubmit` callback its own feature's `TaskDialog`/chat call site passes into
  `HumanStepSurface`. Neither hook file imports the other feature's hook or components.
- Render `HumanStepSurface` **directly** from both `TaskDialog` and the chat surface
  (`AgentSessionChatSurface`/`AgentSessionWorkflowBar`) for the active-interaction case only,
  each via its own feature-local `onSubmit` adapter hook — do not navigate/redirect chat to
  open `TaskDialog` (D7). Remove chat's existing separate Approve/Request-changes/
  `start-review` implementation (the `availableActions.includes('approve')`/
  `('request-changes')`/`('start-review')` rendering block and its `onApproveTask`/
  `onStartReviewTask`/request-changes-composer-mode call sites in
  `agent-session-chat-surface.tsx`) and replace it with: a generic waiting-step control
  (works identically for both executors, consuming the renamed `onStartAgentStep` prop for
  the agent branch and this task's own feature-local hook's `start` for the human branch) and
  `HumanStepSurface` for an active human interaction — no literal `'approve'`/
  `'request-changes'`/`'start-review'` action-id check remains anywhere in the chat surface.
- `HumanStepSurface`'s render condition in both call sites (decided by each feature's own
  wrapper, not by the shared component itself) is the human-step projection's `interaction`
  being non-null (the active-interaction tier specifically) — never
  `currentStep === 'human-verification'` or any other literal step-name/id check. The
  separate waiting-state control's render condition is `availableActions.includes('start-step')`
  with no `interaction` yet, identical for both executors.
- Product-facing labels ("Review," "Approve," "Request changes") come entirely from the
  action DTO's `action.label` metadata, passed through as `label` on each `interaction.actions`
  entry — the component itself never hardcodes review-specific wording (D11); its own name,
  props, and file location stay generic (`HumanStepSurface`, `shared/workflow/`, a
  `start`/`submit` action shape, not `ReviewSurface`/`approve`/`requestChanges`).
- `TaskDialog` also gains general deterministic projection awareness (current step,
  executor, `waiting-for-step-start` shown honestly via the generic step descriptor and a
  generic "Start" control calling the `onStartStep` prop it now **accepts** — this task
  defines the prop and calls it; its real implementation is supplied later by
  `specification-detail-composition-wiring` — never "Ready for review"/"Start review" or any
  other step-id-derived label, identically for an agent or human next step, D15 — never a
  fabricated active state — blocking dependencies, available actions), with
  `HumanStepSurface` rendered as the dialog's content specifically for an **active** human
  interaction (`interaction` non-null) — the waiting-state "Start" control is the dialog's
  own generic rendering, shared with the agent case, not `HumanStepSurface`'s tier-1
  rendering duplicated a second time.
- **In `agent-session-page.tsx` (owned by this task, corrected per the seventh, strictly
  mechanical pass):** `handleStartReviewTask` is renamed to a generic agent-step handler
  (e.g. `handleStartAgentStep`) whose trigger text is produced by calling
  `session-bootstrap-readiness-wiring`'s pure `buildAgentStepTriggerMessage(taskId)`
  primitive — this task does not reimplement that message-building logic, it only imports
  and calls it. This task then renames the prop `agent-session-page.tsx` passes down to the
  chat surface (e.g. `onStartAgentStep`) and updates
  `agent-session-chat-surface.tsx`'s own prop interface and JSX to consume it — both the
  parent's rename and the child's contract change happen inside this one task, since both
  files belong to it, avoiding a consumer-before-producer split across two tasks. No file in
  this task's scope still declares or references `onStartReviewTask`/`onApproveTask` as a
  prop name.
- Legacy `TaskDialog` behavior (the existing `TaskActionFooter` path) is unchanged.

## Acceptance criteria

- `TaskDialog` opened on a deterministic task with a pending human decision on a step not
  literally named `human-verification` renders the surface correctly (brief regression test
  #19's UI half). `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Chat, for the same task/session, renders the identical shared component — proven by both
  call sites importing `shared/workflow/human-step-surface.tsx`.
  `inspection: confirm task-dialog.tsx and the chat surface both import shared/workflow/human-step-surface.tsx, never each other`
- `node --test tools/dashboard/tests/architecture-boundaries.test.mjs` passes — no file
  under `features/specifications` imports from `features/agent-sessions` (or vice versa),
  and `shared/workflow/human-step-surface.tsx` imports nothing from either feature, any
  screen, or any route. `automated: node --test tools/dashboard/tests/architecture-boundaries.test.mjs`
- `HumanStepSurface`'s own source contains no `fetch(`, no route-URL string literal, and no
  `'approve'`/`'request-changes'` literal — every one of those lives in the feature-local
  adapter hooks or the shared transport function, not the component.
  `inspection: confirm shared/workflow/human-step-surface.tsx contains none of these`
- `TaskDialog` opened on a deterministic task whose current step finished and the next step
  (agent or human) not yet started shows the generic step descriptor and a generic
  "[Start]" control — identical wording whether the next step is `review`, `hardening`, or
  any other id — never a fabricated active state, and never "Ready for review"/"Start
  review" as a special case.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- `TaskDialog`'s legacy rendering path (legacy spec, `TaskActionFooter`) is byte-for-byte
  unchanged (brief regression test #14's dialog half).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting a result from either `TaskDialog` or chat POSTs the same
  `{action: 'submit', ...}` body through their own feature-local adapter hook, both
  ultimately calling the same shared `human-step-request.ts` function; activating from
  either entry point POSTs the same `{action: 'start'}` body identically — no divergent
  behavior between the two call sites, and neither ever calls `/workflow/human-decision`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Submitting from a human step with a single unconditional transition omits `result`
  entirely from the request body.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Exactly one `HumanStepSurface` component exists after this task — chat's prior separate
  implementation is removed, not left as a second one.
  `inspection: confirm chat's prior standalone Approve/Request-changes markup is gone`
- No component/operation name in this task's scope hardcodes "review"/"approve" as its own
  identifier (props/exports use `result`/`label` generically, per D11).
  `inspection: confirm HumanStepSurface's own props/exports are generic, not review-specific`
- No file in this task's scope contains the strings `'start-review'`, `'Start review'`,
  `onStartReviewTask`, or `onApproveTask` — `agent-session-chat-surface.tsx` consumes
  `onStartAgentStep` only, and its waiting-step control's visible label is the same generic
  "Start" wording used everywhere else, not "Start review."
  `inspection: confirm none of these four strings appear anywhere in agent-session-chat-surface.tsx`
- `TaskDialog` opened on a deterministic task whose next step is waiting (either `executor`)
  shows a generic "Start" control that, when clicked, calls the `onStartStep` prop this task
  defines — proven with a test-double `onStartStep`, since this task does not own the real
  dispatcher (`specification-detail-composition-wiring`, a later task, supplies it and owns
  the full end-to-end "not a no-op" regression, item 5).
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
- Chat opened on a session bound to a task whose next step is waiting and
  `executor: 'human'` shows the same kind of working generic "Start" control, calling this
  task's own feature-local `human-step-mutations.ts` hook — not a no-op, and not routed
  through `specification-detail-content.tsx`.
  `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`

## Verification

```bash
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
node --test tools/dashboard/tests/architecture-boundaries.test.mjs
```

## Out of scope

Wiring `HumanStepSurface` **itself** onto the task board (D20 — the board's own generic
"Start" control and "human action required" indicator are `task-card-lifecycle-split`'s
scope, D19; they are a different, smaller mechanism than embedding `HumanStepSurface`, not
this task's responsibility) or any timeline entry point beyond `TaskDialog` and chat (future
work). `TaskDialog`'s `onStartStep` prop's real implementation, and
`specification-detail-content.tsx` itself (owned by `specification-detail-composition-wiring`,
a later task that depends on this one, D19) — this task only defines the prop contract and
wires `TaskDialog`'s own consumption of it. Full human-gate engine redesign. Any
artifact/handover attachment rendering.
