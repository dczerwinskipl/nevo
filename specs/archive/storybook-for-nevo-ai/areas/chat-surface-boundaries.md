# Area: chat-surface-boundaries

## Responsibility

Determine, with evidence, exactly what (if anything) must change about the chat/Work
component boundaries so the target chat surface can be rendered from explicit, serializable
UI state — and implement that minimal change, if one is needed.

## Current state

Per `overview.md` § "Current architecture": `AgentSessionComposer`, `AgentSessionTranscriptV2`,
and the whole `work-v2/` tree (`TurnWorkPanelV2`, `WorkTimelineV2`, `WorkIndicatorV2`,
`WorkDetailsSheetV2`, `timeline-projection-v2.ts`) are already props/callback-only — no
`useQuery`/`useMutation`, no SSE, no router reads, no context reads. Only `AgentSessionPage`
(owns the SSE-backed runtime hook plus several React Query hooks) and `AgentSessionRoute`
(router params + React Query) are coupled to live infrastructure. There is currently no
single component that composes composer + transcript + Work into the full chat layout
independently of `AgentSessionPage`'s live wiring — that composition exists only inline in
`AgentSessionPage`'s own JSX today.

This is a starting inference from a read-only pass, not a final architectural decision — the
brief this specification implements explicitly requires inspecting the actual API, not
assuming it is already suitable.

## Requirements

- Task 01 formally answers, with file:line evidence, the seven discovery questions from the
  original goal brief (styling reuse mechanism is answered at the change level already;
  this area answers the component-coupling ones specifically):
  1. Which existing chat/Work components already render in isolation (confirm/extend the
     current-state list above by actually reading every relevant prop/hook/import, not
     relying on this document alone).
  2. Which components are coupled to routing, React Query, SSE, session state, timers, or
     provider-specific data, and exactly how.
  3. Whether the target chat surface (composer + transcript + Work together) has a suitable
     presentation API for deterministic rendering today.
  4. What minimum architectural change is required to render the full chat surface from
     explicit, serializable UI state.
  5. Whether current component boundaries distinguish presentation from application
     orchestration clearly enough, or need adjustment.
- If the audit concludes a new composition point is needed, task 02 implements it as the
  smallest change that satisfies requirement 4 — e.g. extracting the JSX that currently
  assembles composer + transcript + Work inside `AgentSessionPage` into its own
  presentational component accepting explicit props, then having `AgentSessionPage` render
  that component fed from its existing live hooks. This is expected to be a refactor, not a
  rewrite, given how much of the tree is already presentational.
- If the audit concludes no new composition point is needed (Storybook stories can compose
  the existing children directly), task 02 is not required — task 01 documents this
  conclusion and area `chat-stories` composes the existing components directly.
- Any change to a component's existing public props contract must preserve current
  production behavior — this area does not change what the chat surface does, only how it
  can be assembled/rendered.

## Constraints

- Follow `docs/development/react-component-guidelines.md` §§1-5 for any extraction: split
  only where there's a real, independent responsibility boundary, not for its own sake.
- Do not move state, effects, SSE, or React Query ownership out of `AgentSessionPage` unless
  the audit shows a concrete Storybook-blocking reason to do so — the goal is a composition
  seam, not relocating orchestration logic.
- If the audit uncovers that satisfying requirement 4 would require changing
  `AgentSessionPage`'s or another component's existing public props contract in a way that
  could affect other current callers, stop and report the specific decision needed rather
  than deciding unilaterally (public API shape is an owner-approval gate per `AGENTS.md`) —
  do not implement past that point in task 01.

## Interfaces and boundaries

- Consumed by `areas/chat-stories.md`: whatever composition point (existing or newly
  extracted) this area concludes is the correct one to build fixtures/stories against.
- Consumes: none — this area is the first area with no dependency on any other area in this
  change.

## Area-specific acceptance criteria

1. A written finding exists (in task 01's own commit, e.g. as an addition to this area file
   or a dedicated findings section) answering all five requirements above with file:line
   evidence, distinguishing facts from inferences.
2. If task 02 is required, the resulting composition component accepts only explicit,
   serializable props (typed against `CanonicalTurnV2`/`WorkItemV2` and plain callback
   props) — no internal `useQuery`/SSE/router/context reads.
3. `AgentSessionPage`'s current production behavior is unchanged (existing behavior tests
   for the chat surface, if any, continue to pass; `node --test tools/dashboard/tests/*.test.mjs` continues to pass for every test not deliberately migrated by
   `areas/testing-infrastructure.md`).

## Dependencies

None. This area may start immediately.

## Out of scope

- Migrating `AgentSessionRoute` or any routing/query logic — out of scope entirely.
- Any component outside the chat/Work surface (composer, transcript, work-v2).
- Deciding the fixture/scenario data model — that's `areas/chat-stories.md`.

---

## Findings: Component Boundary & Deterministic Rendering Audit (Task 01)

### 1. Scope and Methodology

This audit was conducted by direct source code inspection of all files declared in the task context packet (`overview.md`, `agent-session-page.tsx`, `agent-session-route.tsx`, `agent-session-composer.tsx`, `agent-session-transcript-v2.tsx`, `turn-work-panel-v2.tsx`, `work-timeline-v2.tsx`, `work-indicator-v2.tsx`, `work-details-sheet-v2.tsx`, `timeline-projection-v2.ts`, `types.ts`, and supporting modules).

Per `docs/ai/specification-workflow.md` § "Discovery before specification", observed facts are strictly separated from inferences, inconsistencies, and open questions.

---

### 2. Detailed Component Audit

#### A. `AgentSessionComposer` (`tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx`)
- **Facts (Directly Observed):**
  - Props contract (`agent-session-composer.tsx:25-37`): `AgentSessionComposerProps` accepts `onSend: (text: string) => void | Promise<void>`, optional `onCancel`, boolean flags `isRunning`, `canCancel`, `isProviderAvailable`, `disabled`, `loadError`, `currentMode: AgentExecutionMode`, `onModeChange: (mode: AgentExecutionMode) => void`, optional `placeholder`, and optional `textareaRef`. All props are plain primitives, enums, or callbacks.
  - Hooks used (`agent-session-composer.tsx:1, 52-64`): `useState`, `useRef`, `useCallback`, `useComposerInputMode`, `useIsomorphicLayoutEffect`.
  - Media query dependency (`agent-session-composer.tsx:16-23`): `useComposerInputMode` calls `useMediaQuery('(pointer: coarse) and (hover: none)')` from `usehooks-ts:3` to switch between Enter-to-send (desktop) and newline (mobile touch).
  - External dependencies: Zero calls to `useQuery`, `useMutation`, SSE / event streams, TanStack Router, or React context.
- **Inferences:**
  - `AgentSessionComposer` already renders completely in isolation given valid props. It requires no live backend or provider connections.

#### B. `AgentSessionTranscriptV2` (`tools/dashboard/ui/features/agent-sessions/work-v2/agent-session-transcript-v2.tsx`)
- **Facts (Directly Observed):**
  - Props contract (`agent-session-transcript-v2.tsx:50-66`): Accepts `turns: CanonicalTurnV2[]`, optional `optimisticUserMessage`, booleans `isLoading`, `hasSessionDetails`, `canRetryInitial`, optional `loadError`, number `contentRevision`, optional `displayError`, and callbacks `onReload`, `onBack`, `onRespondInteraction`, `onRetryInitial`, `onDismissError`, `onPointerDown`.
  - Handle contract (`agent-session-transcript-v2.tsx:12-14, 100`): Exposes `AgentSessionTranscriptV2Handle` (`scrollToBottom(behavior?: ScrollBehavior) => void`) via `forwardRef` and `useImperativeHandle`.
  - Hooks used (`agent-session-transcript-v2.tsx:2, 96, 100`): `useScrollFollow` (`transcript/use-scroll-follow.ts:96-98`), `useImperativeHandle`.
  - Scroll controller (`transcript/use-scroll-follow.ts:1-120`): Operates strictly on DOM scroll container geometry (`scrollTop`, `scrollHeight`, `clientHeight`), scroll event listeners, and layout effects. It has no timers, network subscriptions, or queries.
  - Subcomponents rendered (`agent-session-transcript-v2.tsx:5, 16-48, 154-159`): `UserMessageBubble` (local `useState` for collapsing long messages) and `TurnWorkPanelV2` for each turn in `turns`.
  - External dependencies: Zero calls to `useQuery`, `useMutation`, SSE, router hooks, or React context.
- **Inferences:**
  - `AgentSessionTranscriptV2` renders cleanly in isolation for any valid array of `CanonicalTurnV2` fixture objects. Loading, error, empty, active turn, and completed states are all driven deterministically by props.

#### C. `TurnWorkPanelV2` (`tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-panel-v2.tsx`)
- **Facts (Directly Observed):**
  - Props contract (`turn-work-panel-v2.tsx:10-13`): Accepts `turn: CanonicalTurnV2` and `onRespondInteraction: (interactionId: string, response: unknown) => void`.
  - Local state (`turn-work-panel-v2.tsx:22-24`): `expanded` (boolean), `detailsOpen` (boolean), `selectedItemId` (string | null).
  - Child hierarchy (`turn-work-panel-v2.tsx:46-100`):
    - Level 1: `WorkIndicatorV2` (line 46) and `WorkCurrentActivityLineV2` (lines 63, 86).
    - Level 2: `WorkTimelineV2` (line 57).
    - Level 3: `WorkDetailsSheetV2` (line 95).
    - Interactions & outcome: `PendingInteractionViewV2` (line 91) and `FinalAnswerViewV2` (line 93).
  - External dependencies: Zero calls to `useQuery`, SSE, router, or React context.
- **Inferences:**
  - `TurnWorkPanelV2` renders in isolation given a single `CanonicalTurnV2` object.

#### D. `WorkTimelineV2` (`tools/dashboard/ui/features/agent-sessions/work-v2/work-timeline-v2.tsx`)
- **Facts (Directly Observed):**
  - Props contract (`work-timeline-v2.tsx:207-213`): Accepts `historicalWork: WorkItemV2[]`, `onSelectItem: (item: WorkItemV2) => void`, optional `onOpenDetails`, `maxRows`, `embedded`.
  - Implementation (`work-timeline-v2.tsx:220-253`): Wrapped in `React.memo`. Body has zero hooks; calls pure function `projectTimelineV2(historicalWork, { maxRows })` (`timeline-projection-v2.ts:169-207`).
  - Row components (`work-timeline-v2.tsx:29-190`): `ToolGroupRowV2`, `CommentaryRowV2`, `ReasoningRowV2`, `InteractionRowV2`, `OlderHistoryRowV2` are all pure presentation memo components.
- **Inferences:**
  - Fully pure, deterministic presentation component.

#### E. `WorkIndicatorV2` and `WorkCurrentActivityLineV2` (`tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx`)
- **Facts (Directly Observed):**
  - `WorkIndicatorV2` (`work-indicator-v2.tsx:68-110`): Accepts `turn: CanonicalTurnV2`, `expanded: boolean`, `onToggle: () => void`. Formats status label via pure helper `terminalHeaderLabelV2` (`activity-model-v2.ts:99-113`). Zero state, zero timers.
  - `WorkCurrentActivityLineV2` (`work-indicator-v2.tsx:16-60`): Accepts `turn: CanonicalTurnV2`, optional `embedded`. Calls pure formatter `describeCurrentActivityV2(turn.currentActivity)` (`activity-model-v2.ts:41-94`).
  - Timer dependency (`work-indicator-v2.tsx:24`): Calls `useElapsedLabel(display?.startedAt)`.
  - `useElapsedLabel` implementation (`use-elapsed-label.ts:17-30`): If `startedAt` is undefined/absent, line 21 returns early and registers NO interval, and line 26 returns `null`. If `startedAt` is provided, lines 22-24 register `window.setInterval` ticking every 1000ms.
- **Inferences:**
  - Deterministic/frozen Storybook states (e.g. active tool, active thinking) can suppress interval execution by omitting `startedAt` or setting it to undefined, or can test timer progression via standard fake timers (`vi.useFakeTimers()`).

#### F. `WorkDetailsSheetV2` (`tools/dashboard/ui/features/agent-sessions/work-v2/work-details-sheet-v2.tsx`)
- **Facts (Directly Observed):**
  - Props contract (`work-details-sheet-v2.tsx:279-284`): Accepts `turn: CanonicalTurnV2 | null`, `open: boolean`, `onOpenChange: (open: boolean) => void`, optional `initialItemId`.
  - Internal state (`work-details-sheet-v2.tsx:296`): Local `selectedItemId`.
  - Primitives (`work-details-sheet-v2.tsx:3, 304, 312`): Radix UI `Sheet` / `SheetContent` from `@/components/ui/sheet`.
  - Views (`work-details-sheet-v2.tsx:50-276`): `ToolDetail`, `TextDetail` (renders `MarkdownContent`), `WorkList` (Level 3 inspection list).
  - External dependencies: Zero queries, SSE, router, or context.
- **Inferences:**
  - Controlled drawer rendering completely in isolation.

#### G. Supporting modules in `work-v2/`
- **Facts (Directly Observed):**
  - `PendingInteractionViewV2` (`pending-interaction-view-v2.tsx:17-44`): Pure props mapping to `PermissionPrompt` / `QuestionPrompt` (`interactions/interaction-prompt.tsx:1-90`).
  - `FinalAnswerViewV2` (`final-answer-view-v2.tsx:15-30`): Pure props (`finalAnswer: FinalAnswerV2 | null`) rendering markdown or pending message.
  - `timeline-projection-v2.ts:85-207`: Pure TypeScript projection logic (`buildTimelineRowsV2`, `projectTimelineV2`, `normalizeCommentaryText`).
  - `activity-model-v2.ts:41-113`: Pure TypeScript formatters (`describeCurrentActivityV2`, `terminalHeaderLabelV2`).
  - `text-preview-v2.ts:8-44`: Pure string truncation utility (`previewPlainText`).
- **Inferences:**
  - All supporting modules are 100% deterministic.

#### H. `AgentSessionPage` (`tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx`)
- **Facts (Directly Observed):**
  - External hooks / live infrastructure:
    - `useAgentSessionRuntime` (`agent-session-page.tsx:77-86`): Opens live SSE event stream (`agent-event-source.ts:86-135`), creates assistant runtime, and handles HTTP mutations (`postStartTurn`, `postCancelTurn`, `postRespondInteraction`).
    - `useAgentProviders` (`agent-session-page.tsx:68`): React Query hook (`queries.ts:16-25`).
    - `useDeleteAgentSession` (`agent-session-page.tsx:159`): React Query mutation hook (`queries.ts:79-88`).
    - `useInitialDispatch` (`agent-session-page.tsx:91-100`): Auto-dispatches initial prompts.
    - `useVisualViewport` (`agent-session-page.tsx:48`): Observes `window.visualViewport` for mobile keyboard.
    - `<AssistantRuntimeProvider runtime={assistant.runtime}>` (`agent-session-page.tsx:214, 358`): External context provider from `@assistant-ui/react`.
  - State ownership: Owns representation toggle `representation` ('v1' vs 'v2', line 57), modal open state `isSessionDetailsOpen` (line 138), `inspectedTaskId` (line 139), and error states.
  - Inline Chat Surface Layout (`agent-session-page.tsx:272-336`):
    - Renders `AgentSessionTranscriptV2` (lines 273-290) or V1 transcript (lines 291-312).
    - Renders the footer containing `AgentSessionComposer` wrapped in `div.mx-auto.max-w-4xl` (lines 314-336).
    - Inlines cross-component coordination: pointer down on transcript blurs composer (`agent-session-page.tsx:59-65`), and composer submission calls `transcriptHandleRefV2.current?.scrollToBottom('auto')` before starting the turn (`agent-session-page.tsx:171-185`).
- **Inferences:**
  - `AgentSessionPage` is an application orchestration container. It mixes live infrastructure, modal dialogs, and page-level layout with the chat surface assembly.
  - The composite chat surface (transcript container + bottom composer footer + blur/scroll coordination) exists only inline inside `AgentSessionPage`'s JSX. There is no existing component that encapsulates this layout independently of `AgentSessionPage`'s live wiring.

#### I. `AgentSessionRoute` (`tools/dashboard/ui/features/agent-sessions/agent-session-route.tsx`)
- **Facts (Directly Observed):**
  - TanStack Router: Calls `useNavigate` (`agent-session-route.tsx:34, 52, 86, 96, 127`) and `useRouter` (`agent-session-route.tsx:80`).
  - React Query: Calls `useSpecificationIndex` (`agent-session-route.tsx:33`) and `useAgentSessions` (`agent-session-route.tsx:69`).
  - Mounts `<AgentSessionPage />` (`agent-session-route.tsx:185-193`).
- **Inferences:**
  - Pure routing/data-fetching route module; not suitable for isolated rendering.

---

### 3. Answers to Core Audit Questions

1. **Which existing chat/Work components already render in isolation?**
   - `AgentSessionComposer` (`composer/agent-session-composer.tsx`)
   - `AgentSessionTranscriptV2` (`work-v2/agent-session-transcript-v2.tsx`)
   - `TurnWorkPanelV2` (`work-v2/turn-work-panel-v2.tsx`)
   - `WorkTimelineV2` (`work-v2/work-timeline-v2.tsx`)
   - `WorkIndicatorV2` & `WorkCurrentActivityLineV2` (`work-v2/work-indicator-v2.tsx`)
   - `WorkDetailsSheetV2` (`work-v2/work-details-sheet-v2.tsx`)
   - `PendingInteractionViewV2` (`work-v2/pending-interaction-view-v2.tsx`)
   - `FinalAnswerViewV2` (`work-v2/final-answer-view-v2.tsx`)
   - Pure helpers & projections: `timeline-projection-v2.ts`, `activity-model-v2.ts`, `text-preview-v2.ts`

2. **Which components are coupled to routing, React Query, SSE, session state, timers, or provider-specific data, and exactly how?**
   - `AgentSessionRoute`: TanStack Router (`useNavigate`, `useRouter`) and React Query (`useSpecificationIndex`, `useAgentSessions`).
   - `AgentSessionPage`: SSE event streaming and turn commands (`useAgentSessionRuntime`), React Query (`useAgentProviders`, `useDeleteAgentSession`), prompt dispatch (`useInitialDispatch`), browser viewport tracking (`useVisualViewport`), and context (`AssistantRuntimeProvider`).
   - `WorkCurrentActivityLineV2`: A wall-clock interval timer via `useElapsedLabel` (`use-elapsed-label.ts:17-30`), active only when `startedAt` is present.

3. **Whether the target chat surface (composer + transcript + Work together) has a suitable presentation API today?**
   - **No.**
   - While the individual sub-trees (`AgentSessionTranscriptV2` and `AgentSessionComposer`) have clean presentation APIs, their *composition* into a unified chat surface (the scrollable transcript, bottom-anchored composer footer, and interaction coordination such as pointer blur and submit-scroll) exists only inline inside `AgentSessionPage` (`agent-session-page.tsx:272-336`).
   - Stories and component tests cannot currently render the unified chat surface without either duplicating the layout and coordination markup or mounting `AgentSessionPage` with all its live infrastructure.

4. **What minimum architectural change is required to render the full chat surface from explicit, serializable UI state?**
   - Extract a dedicated presentational component, `AgentSessionChatSurface` (or `AgentSessionChatSurfaceV2`), located feature-locally in `tools/dashboard/ui/features/agent-sessions/`.
   - The component will:
     1. Accept explicit props:
        - Transcript data: `turns: CanonicalTurnV2[]`, optional `optimisticUserMessage`, `isLoading?: boolean`, `hasSessionDetails?: boolean`, `loadError?: AgentSessionLoadError | null`, `contentRevision?: number`, `displayError?: string | null`, `canRetryInitial?: boolean`.
        - Composer data: `currentMode: AgentExecutionMode`, `isRunning?: boolean`, `canCancel?: boolean`, `isProviderAvailable?: boolean`, `disabled?: boolean`, `placeholder?: string`.
        - Action callbacks: `onSend: (text: string) => void | Promise<void>`, `onCancel?: () => void`, `onModeChange?: (mode: AgentExecutionMode) => void`, `onRespondInteraction?: (interactionId: string, response: unknown) => void | Promise<void>`, `onReload?: () => void`, `onBack?: () => void`, `onRetryInitial?: () => void`, `onDismissError?: () => void`.
     2. Encapsulate layout & DOM coordination:
        - Render the scrollable transcript area and the pinned footer container (`max-w-4xl`).
        - Coordinate `textareaRef` blurring on transcript pointer down and scrolling to bottom on send.
     3. Contain zero data fetching, zero SSE subscriptions, zero TanStack router hooks, and zero external context providers.
     4. Be rendered by `AgentSessionPage` (replacing lines 272-336 for V2) fed from its existing live hooks.

5. **Whether current component boundaries distinguish presentation from application orchestration clearly enough, or need adjustment?**
   - Inside `work-v2/` and `composer/`, the distinction is clean and follows `docs/development/react-component-guidelines.md` §§1-5.
   - At the `AgentSessionPage` boundary, orchestration and visual composition were merged.
   - Extracting `AgentSessionChatSurface` restores the separation required by `react-component-guidelines.md` §5: `AgentSessionPage` acts as the orchestrator/container, while `AgentSessionChatSurface` acts as the pure visual component.

---

### 4. Facts, Inferences, Inconsistencies, and Open Questions

- **Facts:**
  - All audited files in `work-v2/` and `composer/` accept props and callbacks without calling data-fetching hooks.
  - `AgentSessionPage` directly calls live runtime and React Query hooks and contains inline layout for the chat transcript and composer.
  - Baseline verification: `npm --prefix tools/dashboard test` passes 811/811 tests; `npm --prefix tools/dashboard run build` builds cleanly.
- **Inferences:**
  - Extracting `AgentSessionChatSurface` enables Storybook stories (Task 06-09) and tests (Task 04) to render the full chat workspace deterministically without mocking backend endpoints.
  - The extraction does not require modifying `AgentSessionPage`'s public props contract (`agent-session-page.tsx:32-44`), meaning callers like `AgentSessionRoute` remain completely unaffected.
- **Inconsistencies:**
  - None discovered. The architecture is consistent with the initial findings in `overview.md`.
- **Open Questions & Owner Approval Gates:**
  - *Does the extraction alter any public API or caller contract?* No. `AgentSessionPage`'s props contract is unchanged.
  - *Does it alter package boundaries or dependencies?* No.
  - *Owner approval needed:* None. Per `AGENTS.md`, owner approval is required for public API or dependency breaks. Because this extraction is strictly an internal presentational refactor preserving all behavior, no owner decision gate is triggered.

---

### 5. Architectural Conclusion for Task 02

**Conclusion:** Option (b) is required: a specific, minimal composition change is needed.

**Task 02 Specification:**
1. Create `tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx` (exporting `AgentSessionChatSurface`).
2. Have `AgentSessionChatSurface` encapsulate the layout of `AgentSessionTranscriptV2` and `AgentSessionComposer`, managing internal refs (`transcriptHandleRef`, `textareaRef`), pointer blur, and scroll-on-send coordination.
3. Keep `AgentSessionChatSurface` purely presentational (no queries, no SSE, no router, no context).
4. Refactor `AgentSessionPage` to render `AgentSessionChatSurface` when `representation === 'v2'`, passing down its existing hook state and handlers.
5. Verify that `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build` continue to pass.
