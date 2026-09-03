# Area: chat-stories

## Responsibility

Provide a reusable, typed fixture/scenario model over the canonical chat UI model, and the
five deterministic chat states the original goal brief requires, as Storybook stories with
Args/Controls-editable data.

## Current state

The canonical UI-facing types (`CanonicalTurnV2`, the `WorkItemV2` union, `ToolKindV2`,
`ToolStatusV2`) live in `tools/dashboard/ui/features/agent-sessions/types.ts`. The existing
test file `tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs:210-224`
already hand-builds `WorkItemV2` fixture objects matching this shape (`{ id, seq, type,
toolName, kind, title, subject, description, status, actions, createdAt, updatedAt }`),
which is a useful starting reference for the scenario builders this area formalizes as
reusable, not a duplicate to build from scratch. No fixture/scenario builder module exists
yet.

## Requirements

- A typed fixture/scenario builder module (e.g.
  `tools/dashboard/ui/features/agent-sessions/work-v2/__fixtures__/` or co-located with the
  chat surface component from `areas/chat-surface-boundaries.md` — exact location decided
  during implementation following feature-local ownership conventions) exporting functions
  that build `CanonicalTurnV2`/`WorkItemV2` scenario data without duplicating large object
  graphs across stories (per the goal brief's "reusable typed scenario builders or fixture
  factories" requirement).
- Expose the chat activity list as Storybook Args/Controls (editable object/array) using
  Storybook's built-in Controls — no custom addon/editor. If the built-in Controls prove
  genuinely insufficient for editing a nested `WorkItemV2[]` array, the task documents the
  specific limitation encountered before falling back to any alternative (per the goal
  brief's "demonstrate insufficiency first" instruction) rather than skipping straight to a
  custom control.
- Five required deterministic stories, composed against whatever composition point
  `areas/chat-surface-boundaries.md` concluded is correct:
  1. **Empty chat** — no conversation history, correct empty surface + composer state.
  2. **Existing conversation** — representative user/assistant conversation, populated Work
     timeline with commentary, command execution, file read, file write/edit, search,
     representative completed states, grouped commands (if the canonical model supports
     grouping), and long content sufficient to verify wrapping/truncation/spacing.
  3. **Waiting for first agent activity** — user message submitted, turn started, no
     commentary/tool/final response yet; frozen, deterministic (no real timer).
  4. **Active thinking** — commentary/thinking currently active, frozen for inspection.
  5. **Active tool** — a tool currently running, frozen, with the correct running
     indicator/intermediate styling.
- Each story covers representative desktop and mobile viewports (Storybook viewport
  addon/parameters — already available via `@storybook/addon-docs`'s toolkit, no new addon
  needed).
- Commentary is modeled as its own canonical activity kind distinct from tool execution in
  the fixture model — per `docs/development/nevo-ai-ux-guidelines.md` §7, never
  misclassified as a tool merely to simplify the fixture shape, even though the story's
  displayed list may present a unified chronological list.

## Constraints

- All fixture data uses the canonical UI-facing model (`CanonicalTurnV2`/`WorkItemV2`),
  never raw Claude/Codex/Antigravity protocol payloads (change-wide constraint).
- Frozen/deterministic states (3, 4, 5) must not rely on a real timer, interval, or
  in-progress async operation — they render a fixed snapshot.
- Story content must follow `docs/development/nevo-ai-ux-guidelines.md` and
  `docs/development/ui-ux-guidelines.md` (chronology preservation, L1-L4 information
  budgets, commentary-as-prose, grouping rules) — a story that violates those guides is a
  defect in the story, not a documented "current behavior" exception, unless it's
  deliberately demonstrating a real production bug.

## Interfaces and boundaries

- Consumes: the composition point from `areas/chat-surface-boundaries.md`; the Storybook
  config from `areas/storybook-infrastructure.md`; the Vitest/`addon-vitest` wiring from
  `areas/testing-infrastructure.md` for story-level tests.
- Consumed by: `areas/documentation.md` (documents how to reuse the fixture builders).

## Area-specific acceptance criteria

1. All five required states exist as stories, each rendering deterministically (no timers,
   no network) with no live backend or AI provider running.
2. The activity list in at least the "Existing conversation" story is editable via
   Storybook Controls and re-renders the timeline immediately on edit.
3. Each story is covered by at least a render-level test via `@storybook/addon-vitest`
   (from `areas/testing-infrastructure.md`) confirming it renders without throwing and shows
   its expected canonical content (e.g. the empty story shows no messages; the active-tool
   story shows a running indicator).
4. Desktop and mobile viewports are both verifiable for each story via Storybook's viewport
   controls.
5. No fixture object graph is duplicated verbatim across two or more stories — shared shape
   comes from the scenario builder module.

## Dependencies

- `chat-surface-boundaries`, `testing-infrastructure`.

## Out of scope

- Any chat state beyond the five required ones (additional states are a natural follow-up,
  not required here).
- A custom Controls/JSON editor addon (per overview's Out of scope), unless insufficiency of
  the built-in Controls is first demonstrated and documented.
