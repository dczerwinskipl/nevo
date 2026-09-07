# Area: Work UX presentation

## Responsibility

Define how the semantic server projection (`areas/canonical-turn-work-model.md`) is presented in
chat as three distinct, non-overlapping levels of detail: the collapsed Work indicator, the expanded
Work timeline, and the diagnostic Work Details surface. This area owns the information hierarchy and
interaction shape of Work rendering. It does not own the V1/V2 migration switch, validation corpus,
or cutover mechanics — see `areas/chat-migration-and-validation.md` for those.

## Current state

The prior Work UI used large expandable tool cards for every activity, which is verbose and hard to
scan on mobile, especially for turns with dozens of activities. The target design stays compact
regardless of activity count.

## Requirements

### The three levels

Each level answers exactly one question and must not absorb another level's purpose:

1. **Work indicator** (default collapsed state) — "What is the agent doing right now?" No historical
   activity.
2. **Expanded Work timeline** (tap/click the Work header) — "What has happened so far?" Chronological,
   minimal, text-first.
3. **Work Details** (secondary action from Work) — "What exactly happened technically?" Full technical
   inspection; opens outside the normal transcript flow (side drawer/sheet on desktop, bottom/full-height
   sheet on mobile; a modal is acceptable if it fits the existing component system better).

Implementation must not collapse these three responsibilities back into one large expandable
tool-card UI.

### Icon and text weighting (applies uniformly across all three levels)

Two presentation modes, used the same way in Level 1, Level 2, and Level 3 — never only in the
current-activity indicator:

- **Text-first, no type icon** — Commentary and Reasoning/Thinking. Their content is the primary
  signal; a generic "commentary" or "thinking" icon adds nothing the text doesn't already carry. While
  either is actively streaming, the only indicator is the active-state spinner — that spinner is a
  status indicator, not a semantic type icon, and disappears once the item is historical.
- **Small type icon + label, icon secondary** — ToolInvocation kinds (Read, Edit, Write, Search, List,
  Command, Tests, Web, Generic/other). For a recognized archetype, the icon communicates the activity
  faster than reading the tool title text, so it stays visible wherever a tool renders — but it is
  always small and secondary to the text label, never the reverse.
- **State icons** (active spinner, waiting hourglass, attention warning) communicate turn/activity
  status, not activity type, and may appear alongside either of the above.

Level 3 may render a richer version of the same type icon for tool inspection, but Commentary and
Reasoning entries stay text-first there too — inspection detail does not turn them into icon-led rows.

### Level 1 — Work indicator

- Header shows overall state, top-level activity count, and current/latest meaningful activity (per
  `areas/canonical-turn-work-model.md` § "Activity counting and current activity").
- Current activity renders with: semantic tool title, one concise description (usually file/path/
  command/test name), a running spinner, and elapsed time that keeps increasing while active. No fake
  progress bar when real progress is unavailable.
- Distinguish these current-activity states, each with its own label and truthful semantics:
  - **Tool running** — semantic tool title + description.
  - **Thinking** — only when the provider exposes actual reasoning/thinking evidence. Show one short
    current reasoning line when text/summary is available, otherwise `Thinking…` with spinner and
    elapsed time. Silence alone is never labeled Thinking. No type icon — only the spinner, per "Icon
    and text weighting" above.
  - **Commentary streaming** — rendered as plain text, not a tool-like card, no type icon; may update
    as commentary streams.
  - **Waiting for model** — no active tool and no emitted reasoning/commentary, operation still alive.
    Never labeled Thinking or Requires attention.
  - **Waiting for tool** — used only when the runtime can specifically establish this state and no
    active `ToolInvocation` can be shown instead; prefer showing the real active tool when one exists.
  - **Requires attention** — only when continuation is blocked on user action (permission/question/
    confirmation). Materially distinct from ordinary waiting.

### Level 2 — Expanded Work timeline

- Lightweight vertical timeline (`●` markers connected by a thin line); markers stay small, the
  timeline reads primarily as text.
- One compact line per historical activity: small secondary type icon + semantic label, e.g.
  `Read file · provider.mjs`, `Search code · mapAntigravityTool`, `Edit file · provider.mjs`,
  `Run tests · provider tests`. No large title/description/metadata stacks, no bordered cards.
- Commentary renders as plain text on the timeline, no icon, no "Commentary" label prefix required.
- Reasoning history (when retained) renders as a compact one-line entry, e.g.
  `Thinking · Compared provider lifecycle semantics` — no icon, same text-first treatment as
  Commentary (per "Icon and text weighting" above). Never expose raw chain-of-thought — only
  reasoning/thinking information the provider and canonical model intentionally expose.
- No absolute timestamps in the normal timeline — vertical order communicates chronology. Absolute
  timestamps are Work Details content.
- No per-row duration by default — historical duration is secondary; precise durations belong in Work
  Details. A single unusually long operation may justify a compact duration, but this is not the
  default presentation.
- The current activity (Level 1 content) renders separately below the historical timeline while the
  turn is active: historical timeline above, current activity below. When the current activity
  finishes, it joins the historical timeline and the next current activity takes its place.
- Collapsing hides the timeline only; the current activity remains visible in the collapsed indicator.

### Row density and grouping (Level 2)

This is the level most at risk of bloating back into the old verbose UI, so it gets its own explicit
density rules:

- Keep each row genuinely condensed: this level carries the least data of the three, on purpose. It
  never carries more than a type icon, a semantic label, and one short target (file/path/command/test
  name) — nothing else.
- Icons stay as small as the design system's smallest legible affordance allows — smaller than any
  icon used in Level 1's current activity.
- Row text is set small, deliberately near the lower bound of comfortable reading size (still legible,
  not decorative) — it should read as noticeably more compact than the surrounding chat message text,
  not the same size.
- A run of consecutive, completed ToolInvocations that share the same semantic kind (for example three
  file reads in a row) may collapse into a single condensed row, e.g. `Read file (3)`, whenever that
  can be represented unambiguously:
  - only a genuinely **consecutive** run of the same kind collapses; a different kind, Commentary,
    Reasoning, or Interaction in between breaks the run and starts a new one;
  - the **active** item is never folded into a group — an in-progress invocation always renders as its
    own row (or as Level 1's current activity) until it completes, per "No duplicate active activity"
    below;
  - this is a **presentation-only compaction** of adjacent same-kind rows, never a reordering or a
    global regrouping by type — the underlying canonical Work sequence
    (`areas/canonical-turn-work-model.md` § "Work ordering") is unchanged, and constraint C3 ("Work is
    never grouped globally by type") still governs the real order; grouping is local and visual only;
  - Work Details (Level 3) always lists every individual invocation ungrouped, in its exact original
    order — grouping compacts how Level 2 presents the row, it never hides or merges the underlying
    data.

### Level 3 — Work Details

- Opens from a secondary action on the Work header, or by selecting a tool directly from the compact
  timeline.
- Detailed timeline may show absolute timestamps, richer status/icons, and per-item duration.
- Selecting an individual tool opens its technical details, which may include: normalized semantic
  tool kind, semantic title, provider-native tool name, description, input, output, command, exit
  code, ToolActions, progress information, provider, start/end timestamps, duration, closure reason,
  failure details, and other safe normalized metadata already exposed by
  `areas/canonical-turn-work-model.md`. Provider-private diagnostic/raw envelopes stay outside this
  contract.
- The normal expanded timeline (Level 2) must never inline large technical payloads (full input/output
  JSON, raw command blocks) — that content belongs only in Work Details.

### No duplicate active activity

The Work indicator (current activity) is a projection of current state, not a second persisted
history. The same active `ToolInvocation`, `Reasoning`, or streaming `Commentary` must never render
simultaneously as historical timeline content and as current activity. When it completes, it moves
into the historical timeline and stops being rendered as current.

`CurrentActivity` is a projection over existing canonical state — active `ToolInvocation` | active
`Reasoning` | streaming `Commentary` | `waiting_for_model` | `waiting_for_tool` | pending
`Interaction` — not a second persisted Work item introduced for UI purposes.

### Completed, failed, cancelled, and interrupted turns

- On completion: no Current Activity remains; the last active activity becomes historical; the Work
  header shows the terminal state (`Completed`); Work stays collapsed by default unless the user
  already expanded it; the normal assistant message renders below Work as usual.
- `FinalAnswer` is never rendered a second time inside Work — the chat message bubble is the only
  presentation of it.
- Failed/cancelled/interrupted turns use the same three-level model; the header communicates the
  terminal state (`Failed` / `Cancelled` / `Interrupted`) truthfully. A tool failure does not
  automatically color the whole turn as failed if the agent recovered and completed successfully
  (per `areas/canonical-turn-work-model.md` invariant 4). Keep these distinct:
  - tool failure → warning/error styling on that activity only;
  - turn failure → terminal failure state of the Work header;
  - requires attention → its own blocking-attention styling.

### Icon vocabulary

Type icons communicate activity kind, not status; status carries color semantics instead, via the
separate state icons (spinner, waiting, attention) from "Icon and text weighting" above. Keep the
initial type-icon vocabulary small: Read, Edit, Write, Search, List, Command, Tests, Web,
Generic/other — Commentary and Reasoning/Thinking are intentionally not in this list; they are
text-first everywhere, per "Icon and text weighting." Tool icons stay small and secondary in the
compact timeline (Level 2 keeps them smaller still, per "Row density and grouping"); richer icons are
acceptable in Work Details (Level 3).

## Constraints

- Use the existing design system, tokens, and components where appropriate; this area establishes
  information hierarchy and interaction behavior, not exact colors, icon library, or pixel values.
- All rendering rules here are subject to the change-wide UI boundary in
  `areas/chat-migration-and-validation.md` § "UI boundary" (no provider branching, no command
  parsing, no event-based inference of waiting/attention).

## Interfaces and boundaries

- Consumes: the server chat projection defined in `areas/canonical-turn-work-model.md` and
  `areas/persistence-and-server-projection.md` (Work items, current activity, terminal status,
  activity count). Does not read provider payloads or infer state from raw events.
- Exposes: the collapsed indicator, expanded timeline, and Work Details components that
  `areas/chat-migration-and-validation.md` assembles into the V1/V2 switch during migration and into
  the canonical chat after cutover.

## Area-specific acceptance criteria

Validate at least these states, visually and behaviorally, on desktop and mobile:

1. Tool actively running while Work is collapsed.
2. Tool actively running while Work is expanded.
3. Reasoning/thinking actively streaming while collapsed.
4. Reasoning/thinking actively streaming while expanded.
5. Commentary actively streaming.
6. Waiting for model.
7. Waiting for tool.
8. Requires-attention interaction.
9. Tool completes and moves from Current Activity into the timeline without duplication.
10. Reasoning/commentary completes and moves into history without duplication where retained.
11. Turn completes and Current Activity disappears.
12. Final answer appears only as the normal assistant chat response, never duplicated inside Work.
13. Tool-heavy turn with 40+ activities remains compact and scannable.
14. Opening a tool exposes full technical details without expanding the chat transcript vertically.
15. Work Details allows inspecting the complete richer timeline (absolute timestamps, durations).
16. The same interaction is usable on mobile without horizontal scrolling or giant cards: timeline rows
    stay one line with intelligent path truncation, no full command/input/output inline, small icons,
    adequate touch targets, technical details open in a bottom/full-height sheet, chat scroll position
    is preserved when opening/closing details, and the active spinner/elapsed time stay visible without
    consuming most of the row.
17. A run of several consecutive, completed, same-kind tools in Level 2 may render as one condensed
    grouped row (e.g. `Read file (3)`) while Work Details still lists every individual invocation
    ungrouped, in its exact original order.
18. Commentary and Reasoning/Thinking render without a type icon consistently in Level 1, Level 2, and
    Level 3 — never icon-led in one level and text-only in another.

## Dependencies

- `areas/canonical-turn-work-model.md` — Turn/Work/ToolInvocation/ToolAction/Interaction/FinalAnswer
  shape and the current-activity selection rule this area renders.
- `areas/persistence-and-server-projection.md` — the server projection fields this area consumes.
- `areas/chat-migration-and-validation.md` — hosts this presentation inside the temporary V1/V2 switch
  during migration, and inside the canonical chat after cutover.
- Driven by `tasks/11-semantic-work-chat-v2.md`.

## Out of scope

- The V1/V2 selector, migration validation corpus, and final cutover/cleanup steps
  (`areas/chat-migration-and-validation.md`).
- Any change to the canonical Turn/Work contract or server projection fields — this area only
  presents what those already expose.
- Exact colors, icon library, and pixel-level visual design — decided during implementation against
  the existing design system.
