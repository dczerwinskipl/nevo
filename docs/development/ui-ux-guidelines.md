---
id: development.ui-ux-guidelines
type: development
title: UI and UX guidelines
status: current
read_when:
  - designing or changing frontend UI
  - changing visual hierarchy, typography, spacing, colors, or responsive behavior
  - introducing cards, rows, lists, details views, inspectors, drawers, or sheets
  - designing loading, active, empty, warning, error, or attention states
  - reviewing composed screens or dense repeated content
summary: >
  Portable UI/UX rules for information hierarchy, visual weight, typography, semantic color,
  progressive disclosure, discovery, interaction hierarchy, responsive behavior, dense content,
  visual patterns, and composed-screen verification.
related:
  - development.react-component-guidelines
  - development.nevo-ai-ux-guidelines
  - development.nevo-interaction-model
---

# UI and UX Guidelines

## Purpose

This guide defines product-level UI and UX rules for developer-facing interfaces.

It complements, but does not replace:

- React/component architecture guidelines;
- the implementation-level design system and token definitions;
- accessibility-specific guidance;
- feature specifications.

The guide is intentionally portable. Product-specific semantics and interaction flows belong in product-specific UX and interaction documents.

The goal is not to make every screen look identical. The goal is to make design decisions predictable: what receives visual emphasis, what is hidden, how deeper information is discovered, how state is communicated, and how the composed screen behaves under realistic load.

## Normative language

This document uses the following terms deliberately:

- **MUST / MUST NOT**: stable UX constraints. Implementations are expected to comply.
- **SHOULD / SHOULD NOT**: preferred patterns. A different solution is acceptable when there is a concrete UX reason.
- **MAY / Example**: illustrative implementation. Do not treat examples as required layouts.

Examples, provisional token values, and ASCII diagrams are not authoritative descriptions of the current implementation.

---

# 1. Core design rules

## 1.1 Validate the composed screen

Implementing all requested fields or components is not sufficient.

A UI change **MUST** be evaluated as part of the composed screen, including realistic content volume and state. A component that looks acceptable in isolation can still create a poor hierarchy when repeated or combined with other components.

A compact interface is not compact merely because it uses small fonts, small icons, or few borders. Compactness is determined by the total visual weight and information density of the composed surface.

## 1.2 Design around user questions

Every surface **SHOULD** be able to answer:

1. What is the primary information or action?
2. What is secondary?
3. What is intentionally hidden?
4. How does the user discover the hidden information?
5. What changes when the user goes deeper?
6. What happens with long content or many repeated items?
7. What happens while loading, running, waiting, failing, or requiring attention?
8. What changes on narrow screens?

If the answer to "what is intentionally hidden?" is "nothing", inspect whether the surface needs progressive disclosure.

## 1.3 Visual weight is cumulative

Visual weight is the combined effect of:

- font size;
- font weight;
- foreground contrast;
- spacing;
- icon prominence;
- container background;
- border and radius;
- color;
- repetition.

A smaller font with semibold weight, full foreground, a strong icon, and generous spacing may be visually heavier than larger regular body text.

**MUST NOT** use font size alone as proof that an element is visually subordinate.

---


## 1.4 Design the host surface first

Before designing a nested feature such as Work, inspector content, task details, or an embedded document, identify the **host surface**.

The host surface is the primary user task that must remain visually dominant.

Examples:

- chat is the host surface for Work inside a Turn;
- task details are the host surface for embedded task Markdown;
- changes are the host surface for file inspection.

A nested surface **MUST NOT** become visually or interactionally dominant unless the user explicitly drills into it.

The design review **MUST** answer:

1. What is the host surface?
2. What is subordinate to it?
3. What must remain visible before, during, and after drill-down?

## 1.5 Available space is not an information budget

More screen space **MUST NOT** be used as justification to expose more information by default.

Use additional space to:

- preserve context;
- improve readability;
- reduce crowding;
- show an inspector when the user asks for detail;
- improve alignment and scanability.

Do not automatically add timestamps, metrics, graphs, metadata, or technical subjects simply because desktop has room for them.

# 2. Information hierarchy

## 2.1 Primary, secondary, tertiary

Each surface **MUST** establish a deliberate information hierarchy.

**Primary** information answers the main question of the surface.

**Secondary** information adds useful context.

**Tertiary / metadata** supports inspection but should not compete with the content.

Typical examples:

| Role | Examples |
|---|---|
| Primary | object title, final answer, current blocking state, primary action |
| Secondary | concise explanation, subject, supporting status, commentary |
| Tertiary | timestamp, provider, duration, path, identifier, count |

Not everything may use full foreground, semibold weight, similar size, and similar spacing.

## 2.2 Repetition reduces emphasis

When the same information is repeated many times, its visual weight **SHOULD** decrease.

A state that is useful for one item can become noise across 100 items.

Happy-path state may be represented with a subtle icon or omitted text when the surrounding context already establishes it. Exceptions such as active, warning, failure, cancellation, or required attention should remain easy to find.

## 2.3 Embedded content respects its host

Embedded documents, Markdown, generated reports, and nested content **MUST** respect the hierarchy of the host surface.

For example, if a task title is already rendered by the application shell, an embedded Markdown `h1` repeating the same title should not become a second page-level heading.

---

# 3. Typography

## 3.1 Use semantic typography tokens

Frontend code **SHOULD** use semantic typography tokens rather than arbitrary per-component font sizes.

Typography and spacing tokens **SHOULD** use relative units such as `rem`. Pixel equivalents in this guide describe nominal size at a default `16px` root and are not mandatory CSS literals.

### Provisional typography scale

These values define the target direction until the implementation-level design system becomes the source of truth.

| Token | Nominal value | Intended role |
|---|---:|---|
| `text-page-title` | `1.5rem` to `1.75rem` | page or primary workspace title |
| `text-section-title` | `1.125rem` | major section |
| `text-card-title` | `0.9375rem` to `1rem` | object/card title |
| `text-body` | `0.875rem` | normal application text |
| `text-compact` | `0.8125rem` | dense operational rows/timelines |
| `text-meta` | `0.75rem` | metadata |
| `text-micro` | `0.6875rem` | exceptional micro metadata only |

`text-micro` **MUST NOT** be used to solve density problems for user-critical content.

The default answer to a narrow viewport **MUST NOT** be "make all text smaller".

### Provisional weight scale

| Token | Value | Use |
|---|---:|---|
| `weight-regular` | `400` | body, commentary, most compact rows |
| `weight-medium` | `500` | compact emphasis, selected rows |
| `weight-semibold` | `600` | titles and deliberate emphasis |

Bold/700+ weight **SHOULD** be exceptional in application UI.

## 3.2 Typography roles

- Page and section titles should be clear but not oversized.
- Row titles should remain subordinate to the primary content of the page.
- Commentary and explanatory narration should normally use regular weight.
- Metadata should be smaller and/or lower contrast than the content it describes.
- Technical values may use monospace; semantic labels such as `Run command` should remain in the application UI font.

## 3.3 Readability before density

Responsive design **MUST** reduce information density before reducing readable text size.

On narrow screens, prefer removing or deferring secondary metadata, shortening previews, moving details behind inspection, or collapsing secondary actions.

---


## 3.4 Commentary versus metadata

Narrative text and technical metadata are different typography roles.

Commentary/explanatory prose **SHOULD** normally be:

- regular weight;
- readable at body or compact-body size;
- secondary foreground;
- separated from surrounding actions with spacing/indentation.

Technical metadata such as duration, timestamps, path fragments, and provider information **SHOULD** be visually quieter.

Commentary **MUST NOT** be styled so similarly to command subjects/parameters that users can no longer tell narration from operation metadata.

# 4. Foreground and semantic color

## 4.1 Neutral foundation

Most of the interface **SHOULD** use neutral surfaces and neutral foreground hierarchy.

Primary/accent color is for interaction and active selection, not for tinting the entire interface.

### Semantic foreground contract

| Token | Meaning |
|---|---|
| `fg-primary` | primary readable content |
| `fg-secondary` | supporting content and narration |
| `fg-muted` | metadata and low-priority information |
| `fg-disabled` | unavailable content/control |
| `fg-on-accent` | content displayed on accent surfaces |

Until the token audit is complete, these names describe semantic roles. Existing implementation tokens may map to them.

## 4.2 State colors describe state

Color **MUST** have semantic meaning and **MUST NOT** be used as arbitrary decoration.

### Provisional semantic state tokens

| Token | Provisional value | Meaning |
|---|---:|---|
| `status-active` | `#3882f6` | currently progressing / active selection when appropriate |
| `status-success` | `#35c76f` | successful state when success needs emphasis |
| `status-warning` | `#f59e0b` | recoverable/local problem |
| `status-error` | `#ef4444` | primary operation failed |
| `status-attention` | `#a78bfa` | user action is required |
| `status-info` | `#06b6d4` | informational state, not failure |
| `status-neutral` | neutral foreground | waiting, inactive, historical, or unremarkable state |
| `action-destructive` | initially may share error red | destructive user action |

`status-error` and `action-destructive` are distinct semantic roles even if they initially share the same color value.

A completed historical item **SHOULD NOT** remain strongly green merely because it succeeded. Happy-path history should normally lose color as it becomes less important.

## 4.3 Current dark foundation

The current dashboard already uses a sensible neutral dark foundation. The token audit should preserve the intent of independent neutral surfaces rather than deriving backgrounds from the accent color.

Provisional surface roles:

| Role | Current candidate |
|---|---:|
| background | `#090a0d` |
| surface | `#0f1116` |
| raised surface | `#14171d` |
| hover surface | `#191d24` |
| border | `#252a33` |
| strong border | `#343b47` |

These values are provisional implementation inputs, not permanent documentation contracts.

---


## 4.4 Type uses shape; state uses color

By default:

- object/action **type** should be communicated through iconography, label, or shape;
- semantic **state** should be communicated through color.

Do not assign strong colors to every activity type when color is already needed for active, warning, error, attention, or success states.

Exceptions are allowed when category color itself is a deliberate product convention.

## 4.5 Visual restraint

Before adding another visual signal, inspect the signals already present.

If one element simultaneously uses:

- strong semantic color;
- strong border;
- tinted background;
- icon;
- bold/semibold text;
- status text;
- generous spacing;

the design **SHOULD** question whether multiple signals communicate the same thing.

Prefer the minimum set of signals needed to establish hierarchy and state.

# 5. Spacing and grouping

## 5.1 Use a small semantic scale

A provisional 4px-based spacing scale is recommended:

| Token | Value |
|---|---:|
| `space-1` | `0.25rem` |
| `space-2` | `0.5rem` |
| `space-3` | `0.75rem` |
| `space-4` | `1rem` |
| `space-5` | `1.25rem` |
| `space-6` | `1.5rem` |
| `space-8` | `2rem` |

Spacing should express relationship:

- closely related title/subtitle content uses smaller spacing;
- separate logical groups use larger spacing;
- section separation is larger than internal row spacing.

## 5.2 Prefer hierarchy before borders

Use spacing, typography, alignment, and subtle surfaces before adding another bordered container.

**SHOULD NOT** use card-in-card nesting as the default grouping mechanism.

---

# 6. Progressive disclosure and discovery

## 6.1 Deeper levels increase specificity

Progressive disclosure **MUST** increase specificity, not merely reveal more text.

A useful generic model is:

| Level | Question | Typical content |
|---|---|---|
| L1 Scan / Now | What is happening? | status, title, current activity, primary action |
| L2 Understand / History | What happened so far? | concise sequence, supporting context |
| L3 Inspect | What exactly was involved? | concrete subject, duration, status, relevant metadata |
| L4 Diagnose | What happened technically? | raw input/output, full path/command, low-level diagnostics |

Each deeper level **SHOULD** expose information intentionally omitted from the previous level.

A deeper view may reorganize information for inspection; it does not have to be a larger version of the previous view.

## 6.2 Hidden information must be discoverable

Progressive disclosure without discoverability is not useful.

If deeper information exists, the UI **MUST** provide a clear affordance to reach it.

The user **MUST NOT** need prior knowledge of an invisible click target or internal data model.

## 6.3 Progressive actions

Progressive disclosure applies to actions as well as information.

The primary surface **SHOULD** expose the next natural level of detail. Deeper inspection actions may remain secondary until relevant.

Avoid presenting multiple tiny controls with unclear or overlapping meanings.

---


## 6.4 Define an information budget per level

Each information level **MUST** have a deliberate content budget.

The budget is semantic, not a strict character count.

### L1

May contain:

- object/state label;
- current state;
- current activity;
- one short supporting line.

Should not contain by default:

- exact timestamps;
- durations;
- full technical subjects;
- full commands/paths;
- repeated historical metadata.

### L2

May contain:

- chronological semantic actions;
- concise commentary;
- short subjects when they materially improve understanding;
- current/exception state.

Should not contain by default:

- full command fragments;
- full paths;
- per-row timestamps;
- per-row durations;
- raw input/output.

### L3

May contain:

- concrete filename/command subject;
- exact status;
- duration;
- useful timestamp;
- relevant metadata.

### L4

May contain:

- full path;
- full command;
- input/output;
- low-level diagnostics.

The exact budget depends on the product, but the design **MUST** state what belongs at each level.

## 6.5 Do not promote inspection data upward

Information assigned to a deeper inspection level **SHOULD NOT** be duplicated into a shallower level merely because there is space.

Examples:

- an exact timestamp in L3 should not appear in L2 without a concrete user need;
- a full command in L4 should not appear in L2 because the desktop layout is wide;
- raw provider metadata should not leak into normal UI.

This prevents progressive disclosure from collapsing over time as features accumulate.

# 7. Interaction hierarchy

## 7.1 One obvious primary interaction

A surface **SHOULD** have one obvious primary interaction.

If an entire row/header expands content, the chevron should communicate that same action rather than behave as a separate conceptual control.

Secondary actions must be spatially and visually distinguishable from the primary interaction.

## 7.2 Icon semantics matter

Use icons according to their expected meaning.

Examples:

- info icon: explain a short reason or concept;
- chevron: expand/collapse or navigate within an established hierarchy;
- ellipsis: secondary/overflow actions;
- copy: copy a value;
- warning/error icons: semantic state.

An info icon **SHOULD NOT** be used as a generic "open full technical details" action when it actually performs navigation or inspection.

## 7.3 Small icon does not mean small target

Visual icon size and interactive hit area are separate concerns.

On touch-oriented surfaces, controls **SHOULD** provide a comfortable target, approximately `2.75rem` / 44 CSS px where practical, even when the visual icon is much smaller.

Icon-only controls **MUST** have an accessible label.

---

# 8. Long and technical content

Long content **MUST NOT** dominate the primary workflow by default.

This includes:

- commands;
- paths;
- stack traces;
- raw provider/system output;
- long commentary;
- reasoning;
- technical diagnostics;
- identifiers.

Compact previews should normally:

- collapse whitespace/newlines;
- use one concise line or a deliberately bounded preview;
- truncate or ellipsize;
- avoid rendering large Markdown blocks inline.

Full content belongs in an inspection/detail surface.

Technical values such as commands, paths, hashes, and code may use monospace. Normal semantic UI labels should not.

Long technical values **MUST NOT** control the width of the primary layout.

---

# 9. Repeated and dense content

Repeated UI **MUST** be tested at realistic scale.

At minimum, review a representative repeated component with approximately:

- 1 item;
- 5 items;
- 50+ items.

For activity/log-like surfaces, use a stress case closer to actual production volume where appropriate.

Check for:

- repeated status noise;
- excessive borders;
- oversized row spacing;
- excessive icons;
- repeated metadata;
- loss of primary content hierarchy.

The correct design for three rows may be wrong for 150 rows.

---


## 9.1 Compress repeated history semantically

Dense activity/history surfaces **MAY** group adjacent equivalent items when doing so preserves the user's understanding of chronology.

Good candidate:

```text
Run command
Run command
Read file
Read file
```

may become:

```text
Run command (2)
Read file (2)
```

Grouping **SHOULD** be limited to adjacent, semantically equivalent, low-interest happy-path items.

Grouping **MUST NOT** hide meaningful boundaries such as:

- commentary/narration;
- change of action kind;
- active/current item;
- warning/error/attention;
- user interaction;
- a semantic transition that changes the meaning of the sequence.

A deeper inspection level **SHOULD** allow the grouped items to be inspected individually.

Preserving chronology does not require rendering every canonical item as a separate row.

## 9.2 Mobile density tuning

On narrow screens, operational UI **SHOULD** become denser without reducing the readability of meaningful prose.

Prefer:

- smaller visual icons while preserving comfortable hit targets;
- tighter gaps between repeated rows;
- reduced container padding;
- fewer bordered surfaces;
- shorter previews;
- earlier grouping/collapsing of repeated activity;
- smaller metadata text before reducing commentary/body readability.

Do not solve mobile density by shrinking every text role equally.

Narrative/commentary text should remain easier to read than technical metadata.

# 10. Loading, live state, and feedback

A user action that starts work **MUST** produce immediate truthful feedback.

Do not rely on a disabled control as the only evidence that work started.

Prefer semantic states such as:

- Starting…
- Waiting for response…
- Running tests…
- Waiting for tool result…
- Requires input…

Do not invent a more specific state than the system can prove.

For example, "Thinking" **MUST NOT** be shown unless the application has actual evidence of reasoning/thinking activity.

Existing historical state **SHOULD** hydrate as an atomic snapshot and then receive genuinely new live updates. Existing history should not visually replay unless replay itself is the intended experience.

---

# 11. Responsive information hierarchy

Responsive design is an information-design problem, not only a layout problem.

When space decreases, reduce in roughly this order:

1. tertiary metadata;
2. secondary actions or convert them to compact controls;
3. supporting subtitles;
4. optional labels;
5. secondary status details.

Preserve:

- primary title;
- primary state;
- readable body text;
- primary action.

No horizontal scrolling should be required for normal primary application content. Dedicated technical surfaces such as diffs or code may scroll when necessary.

Wide screens **SHOULD** preserve context by using master/detail or contextual inspection where that improves comparison and navigation.

Narrow screens may represent the same semantic drill-down using a sheet or full-screen detail surface.

---

# 12. Common visual patterns

These patterns describe information structure. They are not mandatory React component APIs.

## 12.1 Information card

```text
Title                                  action
Optional supporting text

Primary content

                              secondary action
```

Rules:

- title is concise;
- subtitle/body/footer are optional;
- do not add structural filler for missing regions;
- one contextual action may appear in the header;
- multiple secondary actions usually belong in a footer or overflow menu;
- long explanations should be shortened and disclosed separately.

## 12.2 Information row

```text
icon  Primary title                    metadata
      Optional secondary text
```

Suitable for dense lists and inspectors.

## 12.3 Inline reason

```text
Action unavailable  [info]
```

Use for a short state/reason where a full explanation would interrupt the workflow.

The disclosure may open a tooltip, popover, sheet, or details surface depending on content length and device.

## 12.4 Status header

```text
status  Object · concise summary                   disclosure
```

The main area should clearly communicate the primary interaction.

## 12.5 Dense activity row

```text
icon  Semantic action
      Optional concise subject/commentary
```

Long command/path/output belongs deeper.

## 12.6 Inspection row

```text
icon  Semantic action                        state
      Concrete subject                  duration  >
```

Inspection views may expose more metadata than primary timelines.

## 12.7 Live operation

```text
spinner  Truthful current activity · elapsed time
```

Elapsed time is useful when operations may legitimately take long.

## 12.8 Details / inspector

A detail surface should contain information intentionally omitted from the previous level.

It should not merely wrap the same content in a larger container.

---


## 12.9 Narration / commentary pattern

Narrative progress text should read as prose between actions, not as another event row.

Default presentation:

```text
Run command
Read file

  Port is 4317, not 4316. Let me retry.

Run command
```

Commentary **SHOULD** normally avoid:

- event-specific chrome;
- strong status icons;
- per-row timestamps;
- heading typography;
- strong semantic color.

Use an icon or stronger treatment only when it adds real meaning.

# 13. Empty, warning, error, and attention states

Empty state content should explain an unusual absence or help the user take the next step.

Do not add "No items" or "Add item" filler when the absence is self-explanatory and there is no useful action.

Warning, error, and attention are distinct:

- **warning**: local/recoverable issue; primary process may still succeed;
- **error**: primary operation failed;
- **attention**: user action is required;
- **active/waiting**: work is in progress or waiting without user intervention.

Error messages should answer:

1. what failed;
2. whether the user must act;
3. where more information is available.

Raw technical errors belong in deeper inspection unless the technical message itself is the useful user-facing answer.

---

# 14. Visual verification

Significant visual work **MUST** be reviewed as a composed screen.

Review at least:

- wide/desktop;
- narrow/mobile;
- empty state;
- active/running state;
- long-content state;
- warning/error/attention state;
- repeated-content stress case.

Ask:

1. What do I see first?
2. Does the primary content clearly dominate metadata?
3. Do repeated rows create noise?
4. Does each detail level actually become more specific?
5. Is the primary interaction obvious?
6. Can hidden information be discovered without prior knowledge?
7. Does mobile reduce information rather than merely shrink it?
8. Does the screen remain usable with real long paths/commands/text?

Screenshots, browser inspection, or equivalent visual evidence should be used for non-trivial visual changes. Green tests alone are not evidence of good UI.

---


## 14.1 Mandatory self-review

For non-trivial visual work, the implementing agent **MUST** perform a self-review against this guide before considering the work complete.

At minimum verify:

- host surface remains dominant;
- no L3/L4 information leaked into L1/L2 without a reason;
- repeated happy-path states do not create noise;
- type is not over-encoded with semantic color;
- commentary still reads as prose;
- mobile reduces information rather than shrinking everything;
- an empty inspector does not reserve unnecessary space;
- long values do not dominate layout;
- the implementation did not expand product scope beyond the requested surface.

If the review identifies a violation, the agent should correct it before finalizing or explicitly document why the exception is intentional.

## 14.2 Scope fidelity

Visual implementation **MUST NOT** silently redesign unrelated product structure.

When asked to design one surface, do not invent:

- unrelated navigation sections;
- new account/org structures;
- new dashboard metrics;
- additional product features;
- new semantic states;

unless they are required by the task or an existing product contract.

Use the existing shell and information architecture as context, not an invitation to expand scope.

# 15. Anti-patterns

Avoid:

- every row looking like a heading;
- full foreground for almost all text;
- semibold used as the default compact style;
- long paths or commands inline in primary views;
- large Markdown rendered inside activity timelines;
- a deeper details view containing less useful specificity than the parent;
- repeated `completed` labels, green checks, or success borders dominating dense history;
- tiny ambiguous icons representing major navigation;
- secondary actions visually stronger than the primary interaction;
- disabled input without visible working feedback;
- existing history visually replayed during hydration;
- responsive design implemented only by shrinking;
- nested cards used as default grouping;
- 11px text treated as automatic proof of compactness;
- semantic state encoded only through arbitrary color;
- using extra desktop width as a reason to expose more metadata;
- empty inspectors permanently reserving layout space;
- designing a nested feature without first identifying its host surface;
- silently expanding product scope while implementing a visual task;
- failing to distinguish narrative commentary from command metadata;
- rendering every repeated canonical history item as its own row when adjacent semantic grouping would preserve meaning.

---

# 16. Token transition rule

The token names and values in this document are intentionally concrete enough to guide the initial UI foundation work.

After the implementation-level design system becomes authoritative:

- exact values should move to code;
- this document should keep semantic roles and canonical token names;
- duplicated implementation values should be removed from this guide;
- components should use tokens according to semantic meaning, not mechanical search/replace.

A token migration is not complete when literals have simply been replaced. Existing UI must be reviewed for whether each element was assigned the correct semantic role.
