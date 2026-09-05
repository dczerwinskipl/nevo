---
id: development.nevo-ai-ux-guidelines
type: development
title: NEvo AI UX guidelines
status: current
read_when:
  - changing the NEvo dashboard UX
  - changing AI chat, Work, tool activity, commentary, reasoning, or turn states
  - changing task, session, specification, changes, or pull-request presentation
  - deciding which canonical AI/session information to expose in the UI
  - reviewing reload, hydration, waiting, attention, error, or mobile behavior
summary: >
  NEvo-specific UX rules that apply the general UI/UX guidelines to AI sessions, chat, Work,
  semantic state, tasks, specifications, changes, and inspection surfaces.
related:
  - development.dashboard-frontend-architecture
  - development.ui-ux-guidelines
  - development.nevo-interaction-model
  - development.react-component-guidelines
  - development.ai-sessions
---

# NEvo AI UX Guidelines

## Purpose

This document applies the general UI/UX rules to NEvo.

It defines product-specific semantics and presentation expectations for:

- AI sessions and turns;
- chat;
- Work and activity;
- tools;
- commentary and reasoning;
- attention and failure;
- specifications and tasks;
- changes and pull requests.

It does not define route structure or every screen-level navigation flow. See `development.nevo-interaction-model` for navigation, drill-down, desktop/mobile presentation, and surface responsibilities.

It also does not define React architecture. See `development.react-component-guidelines`.

## Normative language and freshness

- **MUST / MUST NOT** rules are stable NEvo UX constraints.
- **SHOULD / SHOULD NOT** rules are preferred product patterns.
- Examples and example field lists are non-normative unless explicitly marked otherwise.

This document is a guide, not a snapshot of the current implementation. The canonical domain/API model is authoritative for available data and state semantics. This guide is authoritative only for explicitly marked UX constraints.

Exact canonical field names may evolve. Frontend code must use the actual canonical model rather than copying illustrative field names from this document.

---

# 1. NEvo UX model

NEvo is a developer work surface, not a generic messenger and not a raw provider console.

The UI should present semantic work concepts such as:

- Specification;
- Task;
- AI Session;
- Turn;
- Work;
- Current Activity;
- Tool Invocation / Tool Action;
- Commentary;
- Reasoning;
- Final Answer;
- User Interaction / Requires Attention;
- Changes / Pull Request.

Provider-specific protocol details are implementation concerns unless deliberately exposed in a diagnostic surface.

## 1.1 Canonical semantics first

The frontend **MUST** render canonical meaning rather than reconstructing meaning from raw provider payloads, command text, UI strings, or provider names.

Examples of prohibited frontend inference when canonical semantics are expected to exist:

- `if provider === "claude"` to decide generic presentation;
- parsing shell commands to determine the tool kind;
- mapping provider-native tool names directly in feature UI;
- inferring `Thinking` from arbitrary text;
- guessing turn status from absence of events.

UI responsibility is presentation:

- layout;
- density;
- formatting;
- truncation;
- icon selection;
- responsive behavior;
- progressive disclosure.

## 1.2 Do not duplicate canonical state

Canonical/session state remains canonical state.

Local React state should be reserved for presentation concerns such as:

- expanded/collapsed;
- selected activity;
- opened inspector/sheet;
- local transient interaction state;
- justified optimistic UI.

Frontend code **MUST NOT** maintain a second canonical transcript or session reducer merely to keep the UI alive.

---

# 2. AI turn state

## 2.1 Immediate feedback

After the user starts a turn, the UI **MUST** immediately show truthful activity.

This sequence is acceptable:

```text
Send
→ Starting…
→ Waiting for model response…
→ Commentary / Reasoning / Tool activity
→ Final answer
```

This is not acceptable:

```text
Send
→ composer disabled
→ generic ACTIVE badge
→ empty area
→ first provider event
→ visible Work finally appears
```

A disabled composer is not sufficient activity feedback.

## 2.2 Thinking requires evidence

NEvo **MUST NOT** label silence or generic provider latency as `Thinking`.

`Thinking` or reasoning-specific UI may only be shown when the canonical model contains real reasoning evidence.

Generic waiting should remain generic, for example:

- Starting…
- Waiting for model response…
- Waiting for tool result…

## 2.3 Waiting is not attention

`Requires attention` means the user must act.

It **MUST NOT** be used for:

- a model taking a long time;
- a tool taking a long time;
- waiting for provider output;
- waiting for a known asynchronous operation.

Waiting and attention are separate semantic states.

---

# 3. Status semantics and session status mappings

This document is the authoritative owner of NEvo AI and session domain state mappings to the semantic presentation tones defined in [ui-ux-guidelines.md](ui-ux-guidelines.md) §4.2.

## 3.1 Canonical domain status to semantic tone mapping

| AI / Session domain state | Semantic tone | Rationale and rules |
|---|---|---|
| In-progress turn / running tool / streaming | `active` | Active execution with live evidence. |
| Model latency / waiting for tool output | `neutral` | Waiting is not attention; do not alarm the user. |
| User interaction requested / input required | `attention` | Explicit user action required to continue. |
| Recoverable tool invocation failure | `warning` | Tool error inside a turn; agent may retry or adapt. |
| Failed turn / session fatal error | `error` | Primary operation or turn failed terminally. |
| Active or newly completed turn (current success) | `success` | Immediate feedback for successful completion that warrants momentary emphasis. |
| Historical completed turn / successful tool execution | `neutral` | Quiet resting state; happy-path history loses color to prevent visual noise. |
| User-cancelled turn / aborted action | `neutral` | Intentional user termination; unremarkable resting state that does not signal defect or failure. |
| Unexpected interruption / timeout (sub-step recovered) | `warning` | Non-fatal interruption or tool timeout where containing turn continues or adapts. |
| Unexpected interruption / timeout (primary turn failed) | `error` | Terminal timeout or interruption causing the primary turn or operation to fail. |

## 3.2 Tool failure vs Turn failure

A tool failure **MUST NOT** automatically make the Turn visually failed.

- A recoverable tool failure is mapped to **`warning`**. The agent may correct the command, retry, or choose another tool and still complete the Turn successfully.
- A failed Turn is the primary **`error`** state.

## 3.3 Waiting is not attention

`Requires attention` means the user must act.

It **MUST NOT** be used for:
- a model taking a long time;
- a tool taking a long time;
- waiting for provider output;
- waiting for a known asynchronous operation.

Waiting and attention are separate semantic states.

## 3.4 Historical success loses emphasis

Successful historical tool activity **SHOULD** become visually quiet.

Do not turn large Work histories into walls of green `Completed` labels. Inspection levels may retain exact status information, but the normal history should emphasize exceptions, required attention, and current state.

---

# 4. Chat

## 4.1 Chat is a work interface

The conversation surface prioritizes:

1. user input;
2. final AI response;
3. current Work state;
4. contextual progress/history;
5. technical inspection.

Provider mechanics are secondary.

Avatars and messenger-style decoration are not required.

## 4.2 Final answer remains primary content

Tool activity and progress **MUST NOT** make the final assistant response difficult to find.

Historical Work should be visually lighter than the final answer and user messages.

## 4.3 Composer behavior

Desktop/wide presentation should follow the product interaction contract:

- Enter sends;
- Shift+Enter inserts a newline.

Mobile/narrow presentation:

- Enter inserts a newline;
- sending uses the explicit send action.

While a Turn is active, the composer may be disabled or restricted, but the reason **MUST** be visually obvious through the Turn/Work state.

## 4.4 Reload equivalence

A chat that looks correct only when the browser observed the entire live session is broken.

After reload, reconnect, or re-entry, the user **MUST** see the same logical conversation:

- user messages;
- final answers;
- Work chronology;
- semantic statuses;
- pending interactions.

---


## 4.5 Chat is the host surface for Work

Chat **MUST** remain the host surface for Work inside an AI Turn.

Conceptually:

```text
User message
→ Work / execution context
→ Final assistant answer
```

Work is subordinate execution context, not a replacement dashboard for the conversation.

While a Turn is active and no Final Answer exists yet, Work may temporarily be the primary visible assistant-side content.

Once a Final Answer exists:

- the Final Answer becomes the primary assistant content;
- historical Work **MUST** become visually subordinate;
- Work remains discoverable for inspection.

Desktop width **MUST NOT** be used to transform normal chat Work into a telemetry dashboard with extra metrics, graphs, timestamps, or technical fields that belong deeper.

# 5. Work information levels

Work uses progressive disclosure from state to chronology to technical inspection.

## L1 — Work summary / Now

Answers:

> What is happening now?

Typical information:

- Work;
- action count or concise summary;
- Turn/Work state;
- current activity when active.

L1 is intentionally small and scan-oriented.

The primary interaction **MUST** expose L2.

## L2 — Expanded Work / History + Now

Answers:

> What has the agent done so far?

Typical information:

- chronological semantic activity;
- short tool titles;
- concise commentary;
- short subjects only when they add useful context;
- current active item.

L2 **MUST NOT** become a debugger.

Normal L2 content should avoid:

- full paths;
- long commands;
- raw output;
- full provider-native input;
- large Markdown commentary.

## L3 — Work Details / Inspection list

Answers:

> What exactly did the agent work on?

Typical information:

- concrete filename or command subject;
- semantic action title;
- status;
- duration;
- useful timestamps/metadata;
- drill-down to a single action.

L3 is allowed to be denser and more explicit than L2.

It should preserve chronology rather than grouping actions only for visual convenience.

## L4 — Action Details / Technical inspection

Answers:

> What exactly happened in this action?

Typical information:

- full path;
- full command;
- input;
- output;
- exit code;
- exact timestamps;
- nested tool actions;
- closure reason;
- relevant provider-native diagnostics.

Raw provider capture remains a diagnostic concern and may be deeper still if necessary.

## 5.1 Specificity increases with depth

Each Work level **MUST** expose useful specificity that was intentionally omitted above it.

L3/L4 are not merely larger containers for L2.

---


## 5.2 NEvo Work information budget

The following budget is the default presentation contract.

### L1 MUST prioritize

- Work label;
- semantic state;
- current activity while active;
- concise action count/summary when useful.

L1 **SHOULD NOT** show by default:

- exact timestamps;
- start/last-update metadata;
- per-action duration;
- sparklines/telemetry;
- full command/path subjects;
- historical status repetition.

For completed Work, "last activity" is normally not important enough to remain prominent.

### L2 MAY show

- chronological semantic action titles;
- concise Commentary;
- short filename/subject when it materially improves understanding;
- current action state;
- exception state.

L2 **SHOULD NOT** show by default:

- per-row timestamps;
- per-row duration;
- command fragments merely because space is available;
- full paths;
- full commands;
- raw input/output.

### L3 SHOULD show

- concrete filename or command subject;
- exact status;
- duration;
- useful timestamps/metadata;
- action selection.

### L4 MAY show

- full command/path;
- full input/output;
- exact technical metadata;
- provider-neutral diagnostics.

Information assigned to L3/L4 **SHOULD NOT** be promoted into normal L2 without a concrete UX reason.

# 6. Work chronology

Chronology **MUST** be preserved.

If the canonical sequence is:

```text
Commentary
Tool A
Commentary
Tool B
```

the normal Work history must not reorganize it into:

```text
Commentary section
Tools section
```

when that destroys temporal meaning.

Grouping is allowed only when the canonical semantics support it and the user does not lose relevant ordering.

Real tool invocation boundaries **MUST** be preserved.

---


## 6.1 Semantic grouping in L2

Preserving Work chronology does **not** require one visual row per canonical activity.

L2 **SHOULD** group adjacent, equivalent, low-interest happy-path actions when this reduces noise without changing the user's understanding of the sequence.

Example:

```text
Run command
Run command
Read file · routes.mjs
Read file · serialization.mjs
```

may become:

```text
Run command (2)
Read file (2)
```

A group boundary is normally broken by:

- Commentary;
- Reasoning;
- action kind change;
- active/current action;
- warning, failure, cancellation, or attention;
- meaningful subject/context change when grouping would hide useful meaning.

Example:

```text
Run command
Run command

  Port is 4317, not 4316. Let me retry.

Run command
Read file
Read file
```

may become:

```text
Run command (2)

  Port is 4317, not 4316. Let me retry.

Run command
Read file (2)
```

A warning/exception **SHOULD NOT** disappear inside a generic happy-path group.

If grouping still improves readability, the group must expose the exception clearly, for example:

```text
Run command (3)   warning: 1
```

or keep the exceptional action separate.

L3 Work Details **SHOULD** expose the individual actions that were compressed in L2.

# 7. Commentary

Commentary/progress narration is narration, not a heading.

In compact Work it should normally be:

- regular weight;
- secondary foreground;
- visually quieter than semantic operations;
- concise;
- optionally indented;
- bounded to a short preview.

It should read as:

> the agent explains what it is doing or what it just learned

not:

> a new primary section of the page

Commentary **MUST NOT** receive strong heading styling merely because it is a distinct canonical activity kind.

## 7.1 Large commentary

The canonical model may correctly classify a large Markdown report as Commentary.

That semantic classification does not require L2 to render the entire document.

Presentation may use:

- one-line or bounded preview in L2;
- richer preview in L3;
- full Markdown in L4/inspection.

Semantics and amount of rendered text are separate decisions.

---


## 7.2 Commentary is prose, not an event row

In normal Work history, Commentary **SHOULD** usually render as lightweight prose between semantic actions.

Default Commentary should normally avoid:

- a dedicated event-status icon;
- per-row timestamp;
- heading weight;
- strong semantic color;
- a bordered container.

Example:

```text
Run command
Run command

  Port is 4317, not 4316. Let me retry.

Run command
Read file
```

A stronger visual treatment is justified only when the Commentary itself carries an exceptional state or interaction.

# 8. Reasoning

Reasoning is distinct from Commentary.

The UI **MUST NOT** merge reasoning, commentary, and final answer into one undifferentiated transcript merely because a provider exposes them as text.

Reasoning presentation may be more restricted than commentary depending on product/provider capabilities.

When reasoning is available, it should not dominate the primary chat transcript.

---

# 9. Tool presentation

A Tool Invocation is secondary to the agent's overall work.

## L2 compact activity

Prefer:

```text
Run command
Read file · provider.mjs
Edit file
```

Avoid:

```text
Run command · node --experimental... very long command
Read file · D:\repos\...\very\long\path
```

## L3 inspection

Concrete subjects are expected:

```text
Run command      npm --prefix tools/dashboard test       1.8 s
Read file        provider.mjs                            23 ms
```

## L4 detail

Full technical content is appropriate.

## 9.1 Tool errors

A failed tool should be easy to find, but it is normally a warning unless the Turn itself fails.

The UI should make the difference between:

- tool warning;
- turn error;
- user attention;

immediately understandable.

---


## 9.2 Type versus state in Work

Tool/action type should normally be communicated by icon/label.

Color should primarily communicate semantic state.

Normal historical types such as `Run command`, `Read file`, and `Edit file` **SHOULD NOT** each receive strong category colors if that competes with active/warning/error/attention semantics.

Completed history should normally be neutral.

Active, warning, error, and attention remain intentionally visible.

# 10. Work discovery and actions

Work currently has multiple possible interaction concepts:

- expand/collapse Work;
- open Work Details;
- inspect an individual activity.

These interactions **MUST** have a clear hierarchy.

The next natural level of detail should be the primary disclosure action.

A generic info icon **SHOULD NOT** represent full Work inspection. Info icons are better reserved for explanatory content.

Example preferred direction:

```text
Work · 249 actions · Completed                    chevron
```

The main Work header is the L1 → L2 disclosure target.

After expansion, Work Details may be exposed as a clearly secondary action.

Desktop and mobile presentation are defined in `development.nevo-interaction-model`.

---

# 11. Historical snapshot and live updates

Existing canonical history **SHOULD** hydrate atomically:

```text
loading
→ complete snapshot
→ genuinely new live updates
```

Avoid:

```text
empty
→ 10 actions
→ 40 actions
→ 112 actions
```

when those 112 actions existed before the user entered the screen.

Existing history is not live progress.

Live visual transitions should represent genuinely new state.

---

# 12. Sessions

A Session is the user's persistent AI work context.

Session list/card presentation should primarily help the user:

- identify the relevant session;
- understand its current state;
- understand its relation to specification/task context;
- resume the work.

Provider/model/mode metadata may be shown when useful but **SHOULD NOT** visually dominate the session's purpose or state.

A Session Details surface is for metadata/context and administrative actions. It should not become a second chat transcript or Work history.

---

# 13. Specifications and tasks

Specification and task UI should optimize for:

- orientation;
- progress;
- current work;
- finding the next relevant task/session.

## 13.1 Status and lane are different concepts

Lane is a visual/grouping concept.

Task status is domain state.

The UI **MUST NOT** hardwire the data model to the current board layout.

The design should allow:

- configurable statuses;
- mapping statuses to lanes;
- semantic color mapping owned centrally.

A status does not need to be repeated on every card when the lane already communicates the same information and the repetition adds no value.

## 13.2 Progress summaries

Large breakdowns are useful when the user is inspecting progress but may be excessive in narrow summary cards.

On mobile, a concise progress percentage/count may be primary while the detailed status breakdown moves to a deeper level.

---

# 14. Changes and pull requests

Changes surfaces should answer first:

> What changed?

Technical inspection answers:

> What exactly changed in this file/commit?

The primary surface should emphasize meaningful change groups and file identity. Exact diff content belongs in a dedicated diff/inspection surface.

On wide screens, master/detail presentation may preserve the changes list while inspecting a selected file.

---

# 15. Technical content

NEvo contains unusually long technical values:

- paths;
- commands;
- commit hashes;
- tool input/output;
- provider/session IDs.

Primary UI **MUST NOT** allow these values to control layout width or dominate semantic content.

Use:

- semantic titles;
- filenames or concise subjects;
- truncation;
- copy actions;
- deeper inspection.

Full values remain available when they are useful for debugging or verification.

---

# 16. Desktop and mobile priorities

NEvo should preserve the same semantic information architecture across breakpoints while changing presentation.

Wide/desktop:

- persistent primary navigation is preferred;
- contextual right-side inspection should preserve the main work context;
- master/detail is preferred for repeated inspection tasks.

Narrow/mobile:

- navigation may use a drawer;
- contextual inspection may use a sheet or full-screen detail surface;
- secondary metadata should be reduced before body text;
- technical subjects must not cause horizontal page scrolling.

See the interaction model for surface-specific behavior.

---


## 16.1 Contextual inspector rules

On wide screens, the contextual inspector **MUST NOT** reserve a permanent empty column when nothing is selected.

Preferred behavior:

```text
normal
navigation | chat/main workspace

after deliberate inspection
navigation | chat/main workspace | inspector
```

The inspector appears because the user chose to inspect something.

It should not be filled with placeholder messaging merely to justify permanent layout space.

## 16.2 Mobile Work reduction

Mobile **SHOULD NOT** render hundreds of historical Work actions inline merely because desktop can.

For long Work histories, mobile may use:

- bounded recent/representative history;
- `Show all`;
- dedicated Work Details;
- progressive loading/virtualization.

The goal is to preserve scanability of the conversation, not to compress the entire desktop history into a narrow column.


## 16.3 Mobile Work density

The narrow/mobile Work surface should be deliberately denser than desktop while preserving the readability of AI narration.

Preferred adjustments include:

- smaller visual tool icons;
- tighter vertical gaps between activity rows;
- smaller row/section padding;
- earlier grouping of repeated actions;
- fewer bordered/tinted surfaces;
- compact secondary actions such as text links instead of large buttons;
- shorter L2 previews before `Show all` / `Details`.

Interactive hit areas remain comfortably touchable even when icons look smaller.

Typography priority on mobile:

1. Commentary/narration remains readable.
2. Semantic action title remains scannable.
3. Subject/technical metadata may become smaller/more muted.
4. Timestamps/durations normally move to L3 rather than being squeezed into L2.

Commentary **MUST NOT** visually collapse into command metadata.

# 17. Canonical model to presentation

The canonical model describes what NEvo knows. The UI decides which of those facts are useful at each information level.

Example classification:

| Canonical meaning | Primary UI | Expanded/secondary | Inspection |
|---|---|---|---|
| Turn state | yes | yes | yes |
| Current activity | while relevant | yes | yes |
| Final answer | yes | yes | yes |
| Work chronology | summary | yes | yes |
| Tool semantic title | maybe/current | yes | yes |
| Concrete filename/command subject | rarely | concise | yes |
| Duration | rarely | optional | yes |
| Full command/path | no | no/rare | yes |
| Tool input/output | no | no | yes |
| Provider-native diagnostic metadata | no | no | diagnostic only |

This table is illustrative. The canonical model and interaction purpose decide the exact presentation.

Frontend code **MUST NOT** display every available field merely because the backend provides it.

---

# 18. NEvo visual stress cases

Significant work on AI/session UI should be tested with:

- active Turn before the first provider activity;
- long provider wait;
- pending question/permission;
- tool warning followed by successful Turn;
- failed Turn;
- cancellation/interruption;
- reload during active Turn;
- reload of completed historical session;
- Work with 100–250+ activities;
- long Commentary/Markdown;
- long Windows and Unix paths;
- long shell commands;
- multiple sessions;
- mobile/narrow viewport.

The screen should remain scannable and the final answer should remain easy to find.

---

# 19. NEvo anti-patterns

Avoid:

- every `Read file`, `Edit file`, and `Run command` looking like a heading;
- Commentary styled like a tool heading;
- L2 showing more technical detail than L3;
- giant Commentary Markdown inline in normal Work;
- full paths/commands in compact Work;
- `completed completed completed` dominating history;
- a tiny info icon acting as the main entry to technical inspection;
- inactive-looking UI while a Turn is actually working;
- generic `Thinking` without reasoning evidence;
- historical Work replaying during hydration;
- frontend provider checks controlling generic UX;
- local React state becoming a second canonical transcript;
- task/spec/document headings duplicated by embedded Markdown;
- responsive layouts that keep all metadata by making everything smaller;
- chat Work visually turning into a telemetry dashboard;
- strong color assigned to normal activity types instead of semantic state;
- permanent empty inspector space;
- Commentary rendered as a first-class event row by default;
- L2 timestamps/durations/command fragments added simply because desktop has room;
- rendering every Work action as a separate L2 row when adjacent grouping would preserve chronology;
- reducing commentary readability to make mobile Work fit;
- using large buttons/surfaces for secondary Work actions on narrow screens when a compact affordance is sufficient.
