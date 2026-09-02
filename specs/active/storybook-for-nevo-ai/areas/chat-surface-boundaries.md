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
