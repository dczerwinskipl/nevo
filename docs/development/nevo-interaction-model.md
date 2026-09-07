---
id: development.nevo-interaction-model
type: development
title: NEvo interaction model
status: current
read_when:
  - designing navigation or screen flows in the NEvo dashboard
  - changing how users enter chat, sessions, task details, Work, or inspection views
  - changing desktop sidebar, contextual inspector, mobile drawer, or detail sheet behavior
  - deciding which canonical information and actions belong on a surface
  - changing route hierarchy, back behavior, deep links, or state preservation
summary: >
  Product interaction guide for NEvo surfaces: purpose, entry points, canonical information,
  actions, drill-down, state preservation, and desktop versus mobile presentation.
related:
  - development.ui-ux-guidelines
  - development.nevo-ai-ux-guidelines
  - development.react-component-guidelines
  - development.ai-sessions
---

# NEvo Interaction Model

## Purpose

This document describes how users navigate and inspect NEvo.

It covers:

- what each major surface is for;
- how users reach it;
- which canonical information is relevant there;
- which actions belong there;
- how information depth increases;
- how desktop/wide and mobile/narrow presentations differ;
- what context must be preserved across navigation.

This is a product interaction guide, not an authoritative map of the current implementation.

## Normative language and freshness

- **MUST / MUST NOT** rules are stable interaction constraints.
- **SHOULD / SHOULD NOT** rules describe the preferred interaction model.
- **Example / MAY** content is illustrative and can change as the product evolves.

Field lists, route examples, screenshots, panel widths, and exact layouts are non-normative unless explicitly marked otherwise.

The canonical domain/API model is authoritative for available data and state semantics. Existing routes and implementation details should be verified in code before changing them.

If a screen described here does not currently exist, this document does not imply that it is implemented.

---

# 1. Interaction principles

## 1.1 Preserve context

When users inspect deeper information, NEvo **SHOULD** preserve the context they were working in.

This includes, where relevant:

- current specification;
- selected task/session;
- scroll position;
- expanded Work;
- selected activity;
- active tab;
- filters.

Wide screens should prefer showing detail alongside the primary workspace when that avoids unnecessary context switching.

## 1.2 Drill-down increases specificity

Every drill-down **MUST** have a clear purpose.

A deeper level should answer a more specific user question rather than simply displaying the same content in a larger container.

## 1.3 Discovery is part of navigation

If a deeper surface exists, users **MUST** have a discoverable way to reach it.

Do not depend on users knowing that an arbitrary text region or tiny icon is clickable.

## 1.4 Back follows product hierarchy

Back navigation **MUST** return the user to the meaningful parent context rather than an unrelated fallback route.

Where browser history represents the actual user journey, normal browser/back semantics should be preserved.

A user inspecting details should not lose the parent selection or scroll position without a concrete reason.

## 1.5 Do not expose the internal model as navigation

Users navigate through product concepts such as Specification, Task, Session, Work, and Action.

They **MUST NOT** need to understand internal IDs, provider request IDs, protocol objects, or storage relationships to discover information.

---


## 1.6 Host surface ownership

Every nested interaction must identify its host surface.

Examples:

- Chat hosts Work for an AI Turn.
- Work Details hosts Action Details selection.
- Changes hosts file inspection.
- Task Details hosts embedded task documentation.

The host surface **MUST** remain understandable before, during, and after drill-down.

A nested detail view should not silently redefine the primary task of the page.

# 2. Responsive shell

## 2.1 Wide / desktop shell

Preferred model:

```text
┌────────────────┬────────────────────────────────────┬──────────────────────┐
│ Persistent     │                                    │ Contextual           │
│ navigation     │ Main workspace                     │ inspector            │
│                │                                    │ when relevant        │
└────────────────┴────────────────────────────────────┴──────────────────────┘
```

### Persistent navigation

On sufficiently wide screens, primary navigation **SHOULD** remain visible.

It should not be collapsed into a hamburger merely to mirror mobile behavior.

### Main workspace

The main workspace owns the primary task:

- chat;
- specification/task work;
- Work history;
- changes;
- documentation;
- full diff/document when it needs the width.

### Contextual inspector

The right-side inspector is a contextual detail surface, not a generic modal.

It **SHOULD**:

- appear when the user intentionally inspects something;
- preserve the main workspace;
- update when another related item is selected;
- close without destroying parent context.

It **MUST NOT** permanently reserve empty space when there is nothing meaningful to inspect.

The inspector is hidden by default when no inspection target exists.

Suitable inspector content:

- selected Work action;
- session metadata;
- compact task context;
- selected change/file metadata;
- properties and supporting detail.

Large documents and wide diffs belong in the main workspace rather than being forced into a narrow inspector.

## 2.2 Narrow / mobile shell

Preferred model:

```text
Main workspace

Primary navigation → drawer
Inspection/detail  → sheet or full-screen detail surface
```

The same semantic action should remain recognizable across breakpoints.

Example:

```text
Inspect Work action
desktop → right inspector
mobile  → sheet/full-screen detail
```

Navigation semantics remain stable; presentation changes.

---

# 3. Surface template

When adding or materially changing a NEvo surface, document or reason about it using:

- **Purpose**
- **User questions answered**
- **Source of truth**
- **Canonical information relevant**
- **Information presented**
  - always visible;
  - on demand;
  - inspection only
- **Entry points**
- **Primary interaction**
- **Secondary actions**
- **Desktop presentation**
- **Mobile presentation**
- **Exit/back behavior**
- **State preservation**
- **Normative rules**
- **Examples / current pattern**
- **Known implementation deviations**, when useful

The exact canonical field names are not required in this guide. Use actual model names from code during implementation.

---

# 4. Product hierarchy

Conceptual navigation is approximately:

```text
Specification
├─ Tasks
│  └─ Task
│     └─ related AI Session(s)
├─ AI Sessions
│  └─ Session / Chat
│     └─ Work
│        ├─ Work Details
│        └─ Action Details
├─ Changes
│  └─ selected file / diff
├─ Pull Request
└─ Documentation
```

This diagram describes relationships, not mandatory routes.

Multiple entry points to the same object are valid when they preserve the user's context.

---

# 5. Specification overview

## Purpose

Orient the user within one specification and summarize its current work state.

## User questions answered

- Which specification am I in?
- What is its current status/progress?
- What work remains?
- Where can I go next?

## Source of truth

Canonical specification/task/project state.

## Canonical information relevant

Examples:

- specification identity/title;
- status;
- task counts/progress;
- related sessions;
- changes/PR state.

The overview **MUST NOT** display all available information merely because it exists.

## Always visible

Typically:

- specification identity;
- high-level status/progress;
- primary navigation/actions relevant to the specification.

## On demand

Examples:

- detailed status breakdown;
- secondary metadata;
- related operational summaries.

## Primary interaction

Continue into the relevant work surface, typically Tasks, Sessions, or another explicit specification area.

## Desktop

Specification navigation remains available in the persistent shell.

Detailed summaries may use the available width but should not become a wall of cards.

## Mobile

Progress and orientation remain primary.

Detailed status legends/breakdowns may move behind disclosure if they make the overview excessively tall.

## MUST

- preserve the active specification context across child surfaces;
- avoid duplicating a large specification title when the shell already provides that context.

---

# 6. Tasks list / board

## Purpose

Find a task, understand the distribution of work, and enter the relevant task or session.

## User questions answered

- What tasks exist?
- What is their current status?
- Which tasks are ready/current/blocked?
- Which task should I inspect or work on?

## Source of truth

Canonical task/status configuration.

## Canonical information relevant

Examples:

- task id/title;
- status;
- lane mapping;
- related session state;
- dependencies or relevant blocking state.

## Primary interaction

Open/select a task.

## Secondary actions

Only actions that genuinely belong at task-list level.

Avoid filling every task card with actions that are better placed in Task Details.

## Desktop

Configurable lanes/status groups may use a board or grouped list.

Lane presentation **MUST NOT** become the canonical domain model.

## Mobile

Prefer a vertically scannable list/grouping.

Do not preserve desktop lane width by introducing horizontal scrolling for the primary task experience unless the board itself is explicitly designed as a horizontal canvas.

## MUST

- status semantics come from canonical task state;
- status color comes from central semantic mapping;
- the same status information should not be repeated multiple times without adding value.

---

# 7. Task details

## Purpose

Inspect one task and enter the work associated with it.

## User questions answered

- What is this task?
- What is its current status?
- What does it require?
- Which session/work belongs to it?
- What actions are available?

## Source of truth

Canonical task/specification state plus related session relationships.

## Relevant canonical information

Examples:

- title;
- status;
- description/spec content;
- related sessions;
- dependencies/context;
- task-level actions.

## Information hierarchy

Always visible:

- task identity;
- current state;
- primary action/work entry.

On demand:

- supporting metadata;
- related sessions;
- secondary context.

Inspection/document content:

- full task specification / Markdown.

## Embedded document rule

If the application already renders the task title, embedded Markdown **MUST NOT** create a second competing page-level title.

## Desktop

Task context may remain in main workspace while related session metadata appears in the inspector.

## Mobile

Task details become a normal full-width detail surface. Secondary metadata may be collapsed.

## Back/state preservation

Returning to the task list should restore the relevant list/board position and specification context where practical.

---

# 8. AI sessions list

## Purpose

Find and resume an AI work context.

## User questions answered

- Which session is relevant?
- Is it active, waiting, attention-required, completed, or failed?
- Which task/specification is it linked to?
- Which provider/model context is relevant when needed?

## Source of truth

Canonical AI session projection plus specification/task relationships.

## Always visible

Prefer:

- session identity or meaningful title;
- related task/context;
- semantic session/turn state;
- primary resume/open affordance.

## Secondary/on demand

Examples:

- provider;
- model;
- mode;
- timestamps;
- usage/diagnostic metadata.

## Primary interaction

Open the session/chat.

## Secondary actions

Session administration or details.

## MUST

- provider metadata must not visually dominate session purpose/state;
- disabled/unavailable providers may affect actions without making historical session content disappear.

---

# 9. Chat / Session workspace

## Purpose

Continue the conversation and understand the AI's current work without losing the final dialogue.

## User questions answered

- What did I ask?
- What did the AI answer?
- Is the AI working now?
- Does it need my input?
- What work has happened?
- How can I inspect that work?

## Source of truth

Canonical session/turn projection.

## Relevant canonical information

Examples:

- user messages;
- final assistant messages;
- active Turn state;
- CurrentActivity;
- Work;
- pending question/permission/attention;
- session metadata.

## Information hierarchy

Always visible:

- conversation;
- current Turn/attention state;
- composer when interaction is allowed.

Progressively disclosed:

- Work history.

Inspection:

- Work Details;
- selected activity/action details;
- session metadata.

## Primary interaction

Send/continue conversation when allowed.

During active work, the primary visual state becomes truthful current Work feedback.

## Desktop

Main workspace contains the transcript and Work.

Session/context inspection should prefer the right inspector over modal overlays when preserving the conversation is useful.

Persistent primary navigation remains visible.

## Mobile

Chat uses the full width.

Navigation uses a drawer.

Session/Work inspection uses sheets or full-screen detail surfaces.

## MUST

- active Turn state must be visible immediately;
- final answers must remain easy to find;
- reload/re-entry must reconstruct the same logical conversation;
- pending user interaction must be distinguishable from normal waiting.

---

# 10. Work summary and expanded Work

## Purpose

Expose AI work progressively without turning chat into a raw log.

## Source of truth

Canonical Turn Work projection.

## L1 Work summary

Answers:

> What is happening now?

Typical information:

- Work label;
- concise count/summary;
- semantic state;
- CurrentActivity while active.

### Primary interaction

Expand/collapse Work.

The main header area and chevron should represent the same primary disclosure action.

### MUST

- L1 → L2 disclosure must be easy to discover;
- a tiny secondary icon must not be the only obvious way to understand Work.

## L2 expanded Work

Answers:

> What has happened so far?

Typical information:

- chronological semantic activities;
- concise commentary;
- compact tool titles;
- short subjects only when valuable.

### Secondary action

Open Work Details.

This action should be visually subordinate to expand/collapse.

### Desktop

L2 remains in the main chat/workspace.

A Details action may populate the right inspector with L3 when that preserves context.

### Mobile

L2 remains inline with chat.

Work Details may open a sheet or full-screen detail surface.

---


## 10.1 Work interaction hierarchy

The Work surface has three distinct interaction concepts:

1. **Expand/collapse** the inline Work history.
2. **Open Work Details** for a more concrete ordered inspection list.
3. **Inspect one action** for technical detail.

These interactions **MUST NOT** compete visually as equal tiny controls.

Preferred hierarchy:

```text
L1 Work header
  primary: expand/collapse

L2 expanded Work
  secondary: Work Details

L3 Work Details
  primary: select action

L4 Action Details
  contextual actions: copy/open/etc.
```

An `info` icon **SHOULD NOT** be used for L3/L4 navigation. It should remain reserved for explanatory help/reasons.

## 10.2 Chat-first Work presentation

Work **MUST** be visually embedded in the conversation Turn.

The normal transcript hierarchy is:

```text
User message
Work
Final assistant answer
```

When the Turn completes, Work should visually recede relative to the Final Answer.

Work **MUST NOT** be redesigned as a standalone monitoring dashboard inside chat.


## 10.3 Grouped L2 actions

L2 is a readable semantic history, not a one-row-per-event renderer.

Adjacent equivalent actions may be compressed:

```text
Run command (2)
Read file (3)
```

Interaction expectations:

- selecting/expanding a group may reveal its members when useful;
- entering Work Details must expose the individual underlying actions;
- warnings/active states must remain discoverable and must not be silently swallowed by grouping;
- Commentary or a semantic transition breaks the group.

The user should be able to understand the chronological sequence without needing to expand every group.

# 11. Work Details

## Purpose

Inspect the concrete operations that make up Work without immediately dropping to raw tool payloads.

## User questions answered

- Which exact file or command was involved?
- Which action failed or took a long time?
- What was the status/duration?
- Which action should I inspect further?

## Source of truth

Canonical ordered Work/tool activity.

## Typical information

- semantic action title;
- concrete filename or command subject;
- status;
- duration;
- useful timestamps;
- action drill-down.

Exact fields are illustrative.

## Primary interaction

Select/inspect an activity.

## Desktop

Preferred master/detail behavior:

```text
Work Details list            Contextual inspector
------------------           --------------------
Run command                  selected action
Read file                    full command/path
Edit file                    input/output/etc.
```

The list remains visible while the selected action is inspected.

## Mobile

Work Details is a dedicated list surface.

Selecting an action opens a full-screen/sheet Action Details surface.

## MUST

- preserve canonical chronology;
- expose more concrete information than L2;
- selecting an action must not destroy the parent Work context.

---


## 11.1 Long Work histories on mobile

A mobile chat **SHOULD NOT** inline the entire historical Work list when the list is large.

Preferred progression:

```text
Work summary
→ concise expanded preview
→ Show all / Work Details
→ Action Details
```

This preserves the conversation as the host surface.

Desktop may keep more history visible because the main workspace has more room, but additional space is not a reason to move L3/L4 metadata into L2.


## 11.2 Mobile compactness

For narrow screens, Work preview should optimize vertical cost.

Prefer:

- compact activity rows;
- semantic grouping;
- smaller visual icons with unchanged comfortable touch targets;
- reduced row gaps/padding;
- a compact `Details →` / `Show all` affordance;
- minimal surface/container nesting.

Do not add separate bordered cards for user message, assistant message, Work, and Final Answer merely to create separation. Use typography, spacing, and limited surfaces.

Assistant response remains normal transcript content. User messages may use a compact bubble/surface for conversational distinction.

Sender labels, avatars, and timestamps **SHOULD NOT** be shown by default when ownership/order is already obvious.

# 12. Action Details

## Purpose

Provide technical inspection for a single Work activity/tool action.

## User questions answered

- What exactly was executed/read/edited?
- What input/output was involved?
- Why did it fail?
- What technical metadata is relevant?

## Source of truth

Canonical tool/action detail plus intentionally exposed provider-neutral diagnostics.

## Inspection information

Examples:

- full path;
- full command;
- input;
- output;
- exit code;
- duration;
- timestamps;
- closure reason;
- nested actions;
- relevant errors.

Provider-private IDs and raw payloads remain hidden unless the explicit diagnostic surface allows them.

## Actions

Examples:

- copy command;
- copy path;
- open related file/diff when supported.

## Desktop

Right inspector is preferred when content fits and keeping the parent list is useful.

Very large outputs may need a wider/full workspace.

## Mobile

Full-screen detail or sheet.

## MUST

- technical content must be selectable/copyable where that is useful;
- long values must not break layout;
- back/close returns to the same Work/selection context.

---

# 13. Session Details

## Purpose

Inspect session metadata, relationships, capabilities, and administrative actions.

It is not a second transcript view.

## User questions answered

- Which provider/model/mode does this session use?
- Which specification/task is it associated with?
- What is its current availability/state?
- Which administrative actions are possible?

## Source of truth

Canonical session metadata and relationships.

## Typical information

Examples:

- provider;
- model;
- mode;
- linked specification/tasks;
- session state;
- timestamps;
- relevant capabilities/access;
- destructive session actions.

## Primary interaction

Return to/resume the session when that is meaningful.

## Secondary/admin actions

Examples:

- copy identifier;
- delete/remove local session relationship;
- other explicitly supported administration.

Destructive actions must remain visually separated from normal navigation.

## Desktop

Prefer contextual right inspector or a dedicated details panel depending on information volume.

## Mobile

Use a full-screen/sheet details surface.

## MUST NOT

- duplicate the full transcript;
- duplicate Work history;
- expose raw provider diagnostics as normal metadata.

---

# 14. Changes

## Purpose

Understand what changed for the current specification/work context.

## User questions answered

- Which files changed?
- What kind of change occurred?
- Which change should I inspect?

## Source of truth

Canonical/project Git change model.

## Primary surface

Prefer meaningful file/change grouping and concise identity.

## Primary interaction

Select a file/change to inspect.

## Desktop

Prefer master/detail when useful:

```text
change/file list          diff / selected-file inspector
```

A full diff may use the main workspace when width is needed.

## Mobile

File list first; selected diff becomes a dedicated detail surface.

Horizontal scrolling is acceptable inside the code/diff surface when technically necessary, not for ordinary navigation.

---

# 15. Pull Request

## Purpose

Understand PR state and navigate to the relevant review/change information.

## User questions answered

- Does a PR exist?
- What is its state?
- What review/check status matters?
- What action is available?

## Source of truth

Canonical PR/GitHub integration state where available.

## Information hierarchy

Always visible:

- PR identity/state;
- meaningful checks/review state;
- primary navigation/action.

On demand:

- detailed checks;
- metadata;
- commits/change relationships.

The PR surface should not duplicate the full Changes experience when a direct link/drill-down is more appropriate.

---

# 16. Documentation

## Purpose

Read project/specification documentation without competing application chrome.

## Source of truth

Documentation content and navigation model.

## Primary interaction

Read/navigate documents.

## Desktop

Persistent navigation may remain visible.

Documentation navigation may use an additional contextual structure if it does not create redundant sidebars.

## Mobile

Document content receives the width; navigation moves behind a drawer/list.

## MUST

- embedded Markdown hierarchy must respect the host surface;
- long code/tables may scroll locally without making the whole page horizontally scroll;
- application metadata should not dominate the document.

---

# 17. Info, popover, sheet, inspector, and page choice

Choose the detail surface based on purpose.

## Info / tooltip / popover

Use for:

- short explanation;
- why an action is unavailable;
- small contextual help.

Example:

```text
Action unavailable  [info]
```

## Right inspector

Use on wide screens for:

- repeated item inspection;
- metadata;
- selected Work action;
- contextual details that benefit from preserving the main workspace.

## Sheet / full-screen detail

Use on narrow screens when:

- content cannot fit beside the main surface;
- the same semantic inspection exists as a desktop inspector.

## Main page/workspace

Use when the content itself becomes the primary task:

- large document;
- full task/spec content;
- wide diff;
- complex Work/detail workspace.

## MUST

The chosen container must reflect the interaction purpose. Do not use a modal/popover simply because it is easy to implement.

---

# 18. Navigation and state preservation matrix

| Transition | Preserve |
|---|---|
| Specification → Task → back | specification, task-list context/position where practical |
| Task → Session → back | task/spec context |
| Chat → Work Details → back | chat scroll, Work expansion |
| Work Details → Action Details → back | selected Work context and list position |
| Session → Session Details → close | chat/session context |
| Changes → file diff → back | change list selection/position |
| Mobile detail sheet → close | parent surface and scroll |

These are product goals. Exact implementation may use route state, URL state, component state, or another mechanism consistent with the React/router guidelines.

---

# 19. Deep links and route semantics

Meaningful product surfaces **SHOULD** be deep-linkable when that supports normal navigation, refresh, and sharing.

Route structure should preserve the conceptual hierarchy rather than forcing the UI to rediscover parent context from unrelated identifiers.

The interaction model does not mandate exact URL syntax.

When a route includes a Specification and Session relationship, the application should preserve that hierarchy instead of resolving the Specification indirectly from a chat/session identifier unless the product explicitly supports context-free sessions.

---

# 20. Current implementation is not the specification

The current dashboard is a useful source of real content, stress cases, and existing patterns. It is not automatically a design baseline.

When implementation and this guide differ:

1. check whether the relevant rule is `MUST/MUST NOT`;
2. verify the canonical model and current product requirement;
3. treat examples/layouts as illustrative;
4. update this guide when the product decision itself changed;
5. do not preserve a poor current interaction merely because it already exists.

Known kinds of implementation drift that this model is intended to prevent include:

- ambiguous Work controls where expand and deeper inspection compete;
- mobile layouts that retain too much secondary metadata;
- detail surfaces that fail to reveal more concrete information;
- modal/popup use where a contextual desktop inspector would preserve context better.

---


# 20.1 Scope fidelity for interaction design

This interaction model describes how existing product concepts should connect.

When implementing or mocking one flow, **MUST NOT** invent unrelated navigation groups, product areas, metrics, account structures, or interaction modes unless the task explicitly requires them.

A mock should validate the requested interaction, not redesign the entire product shell by default.

# 21. Interaction review checklist

Before finishing a new or changed flow, verify:

1. What is the purpose of each surface?
2. Which canonical source owns the information?
3. Which information is always visible, disclosed, or inspection-only?
4. What is the one obvious primary interaction?
5. Can the user discover deeper detail without prior knowledge?
6. Does each drill-down increase specificity?
7. Is back behavior predictable?
8. Is parent selection/scroll/context preserved?
9. How does the same semantic action work on desktop and mobile?
10. Is a modal/popup being used where an inspector, sheet, or page would better match the task?
11. Are any provider/internal IDs leaking into the user's navigation model?
12. Would reload/deep-linking reconstruct the same meaningful context?
13. Is the host surface still clearly primary?
14. Did any L3/L4 information leak into a shallower level without a concrete reason?
15. Is the inspector absent when there is nothing to inspect?
16. Did the implementation stay within the requested product scope?
17. Could adjacent happy-path activities be grouped without losing chronology?
18. On mobile, did we reduce padding/surfaces/metadata before reducing commentary readability?
19. Is commentary visually distinct from command subject/metadata?
