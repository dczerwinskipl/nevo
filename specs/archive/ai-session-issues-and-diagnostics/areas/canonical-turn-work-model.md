# Area: Canonical Turn and ordered Work model

## Purpose

Define the single provider-neutral model consumed by runtime, persistence, server projection, and
provider mapping tasks. Exact exported type/file names are frozen by Task 04 after provider evidence,
but the semantic shape and invariants below are mandatory.

## Canonical aggregate

Conceptually, one Turn record contains:

```text
Turn
  identity and timestamps
  status                 # active/waiting/attention/cancelling/terminal/unknown
  WorkItem[]             # stable chronological top-level sequence
    Commentary
    Reasoning
    ToolInvocation
      ToolAction[]       # ordered children, never fake invocations
    Interaction
  FinalAnswer?           # separate from Work
  terminal outcome/cause/initiator?
  provider operation and persistence-health summary
```

Provider-private IDs may be retained only inside adapter correlation/diagnostics. Every public item
receives a stable Nevo ID.

## Turn status

Use a discriminated status rather than independent booleans that can contradict each other:

- `active`
  - detail: provider startup, model/response processing, commentary production, reasoning
    production, or tool execution;
  - optional subject Work/tool ID;
- `waiting`
  - reason: provider/model response or tool result;
  - optional subject ToolInvocation ID;
  - requires no user action;
- `requiresAttention`
  - reason: permission, question, or confirmation;
  - required Interaction ID;
- `cancelling`
  - initiator and request timestamp while cleanup/acknowledgement is pending;
- `terminal`
  - outcome: `completed`, `failed`, `cancelled`, or `interrupted`;
  - structured cause/initiator and completion evidence;
- `unknown`
  - genuinely incomplete/lost ownership or unreadable persistence where no honest terminal
    classification is available.

The exact discriminant names may be adjusted once fixtures are complete, but these distinctions
cannot be merged. Status carries `since` and an evidence source. A state may be projected only when
adapter/runtime evidence supports it. Absence of events alone does not prove waiting or inactivity.

## Work ordering

- The neutral coordinator assigns a monotonically increasing `sequence` when it accepts a new
  top-level Work item.
- Deltas and updates mutate the existing item's content/status and do not assign a new position.
- Provider timestamps are retained as metadata but do not override accepted sequence order.
- Concurrent provider events are ordered by coordinator acceptance. The same sequence is persisted
  and projected through SSE/reload.
- FinalAnswer is not a Work item and always renders below Work.
- Usage, process facts, and diagnostic transitions are not Work items.
- Transient wait status is projected after the latest Work item only while current; it does not
  receive a durable Work sequence by default.

## Commentary

Commentary is user-visible narration during execution. It has stable identity, ordered sequence,
text/chunks, start/update/completion timestamps where evidenced, and a content status. It must be
provider-classified below the UI boundary. Legacy/order-based fallback, if temporarily required for
a provider version without phase metadata, is adapter-owned, explicitly tested, and marked derived;
the browser never performs it.

## Reasoning

Reasoning is provider reasoning/thinking information that the provider contract permits Nevo to
expose. It records a representation such as summary, raw/provider thinking text, or another
provider-defined displayable form. Summary and raw/content deltas are not silently merged when the
provider distinguishes them. Sensitive/private reasoning that is not browser-safe stays out of the
chat projection and may be represented only by a safe status/summary.

## ToolInvocation

A ToolInvocation contains:

- stable Nevo invocation ID and provider correlation held below the public boundary;
- semantic `kind` from a bounded neutral vocabulary (for example command, file operation, search,
  web, MCP/external tool, or other);
- provider-derived `title` and optional description suitable for primary UI presentation;
- status: queued/active/completed/failed/cancelled/interrupted/unknown as supported by evidence;
- start/end timestamps and duration when available or runtime-observed, with provenance;
- ordered `actions: ToolAction[]`;
- optional bounded progress summary;
- expandable technical details such as sanitized/raw command, input, output, exit code, and provider
  tool name; and
- closure reason when terminal status was inferred from owning Turn termination rather than a
  provider-reported invocation result.

A provider-reported failed invocation does not fail the Turn by implication.

## ToolAction

A ToolAction explains a semantic sub-action inside one invocation. It has ordered child position,
semantic kind, title/description, and optional target/details/status/timestamps only when supplied
or safely derived by the adapter from explicit structured provider data. It does not have an
independent invocation lifecycle unless the provider actually supplied one.

For a Codex command item, the expected shape is:

```text
ToolInvocation: command / "Inspect specification"
  ToolAction: search / "Search workflow documentation"
  ToolAction: read / "Read change.yaml"
  ToolAction: read / "Read overview.md"
```

This remains one invocation with one operation ID and terminal result. The exact action-kind mapping
must come from the captured Codex schema/events.

## Interaction

Permission, question, and confirmation are ordered Work items with pending/resolved/denied/cancelled
status, presentation-safe prompt/details, response summary, timestamps, and resume policy. A pending
interaction drives `requiresAttention`. Resolution updates the same Work item and returns the Turn to
an evidenced active/waiting state.

## FinalAnswer

FinalAnswer has stable identity, content/chunks, `pending | streaming | completed | absent` delivery
state, timestamps where evidenced, and provider completion correlation below the public boundary.
Only provider evidence mapped as final-answer phase may populate it. On failed/cancelled/interrupted/
unknown Turn completion, partial commentary or reasoning remains Work; it is never copied into
FinalAnswer.

## Activity counting and current activity

- `activityCount` counts persisted top-level Work items: Commentary, Reasoning, ToolInvocation, and
  Interaction.
- Nested ToolAction values do not increase the top-level count.
- Transient waiting rows do not increase the count.
- The server projection selects `currentActivity`/`latestMeaningfulActivity` from canonical state,
  with a semantic kind, title, and status. The UI does not recompute it.
- A pending interaction takes attention presentation; an active ToolInvocation identifies the
  current tool; otherwise current status supplies model/tool waiting or production information.

## Invariants

1. A top-level item never changes type or sequence.
2. A ToolAction never escapes its owning invocation merely for presentation.
3. A terminal item never returns to active.
4. Turn terminal outcome and ToolInvocation outcomes are independent.
5. Exactly one pending blocking interaction may own `requiresAttention` unless provider discovery
   proves and the model explicitly supports a multi-interaction set.
6. FinalAnswer content never aliases commentary/reasoning storage.
7. Unknown evidence is explicit and never normalized to success, idle, or cancellation.
8. Public semantic fields contain no provider-private correlation identifiers or raw payloads.
