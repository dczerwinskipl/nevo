# Area: Chat migration, Work UX, validation, and cleanup

## Purpose

Build a clear chat UI over the semantic server projection while V1 remains usable, validate the
model across providers and devices, then remove every migration path so the result is one canonical
implementation.

## UI boundary

V2 components consume only the server chat projection. They may format semantic values, choose
visual hierarchy, and manage local expand/collapse state. They must not:

- branch on provider identity/protocol types;
- parse commands or tool payloads to create labels;
- classify commentary versus final/reasoning;
- reconstruct tool lifecycle from low-level events;
- derive waiting/attention from event absence; or
- select the active invocation by scanning provider-shaped data.

## Collapsed Work

Collapsed Work communicates:

- overall state: in progress, waiting, requires attention, completed, failed, cancelled,
  interrupted, or unknown as supplied by projection;
- top-level activity count;
- current/latest meaningful semantic activity;
- whether user action is required and a short attention summary; and
- whether details can expand.

Examples are directional, not hardcoded copy:

```text
Work - 12 activities - In progress
1 active tool - Inspecting specification

Work - Waiting
Waiting for model response

Work - Requires attention
Permission required to run command
```

Do not turn the header into a dashboard of all available counters. Nested ToolActions do not inflate
the activity count.

## Expanded Work

Expanded Work renders the chronological top-level sequence. A ToolInvocation may expand its nested
actions and technical details without moving those actions to top level.

```text
Commentary
  Checking adapter specifications...

Tool
  Inspect specification
    completed  Search workflow docs
    completed  Read overview.md
    active     Read change.yaml

Commentary
  The contract loses command action semantics.

Reasoning summary
  Analysing provider differences...

Waiting (transient current state)
  Waiting for model response...
```

Only active/relevant items receive strong emphasis. Completed historical Work is quieter. Raw
command/input/output/details are expandable and secondary.

## Requires attention

A pending Interaction renders at its chronological position and remains clearly actionable:

```text
Requires attention
Permission required to run PowerShell command.
[Allow] [Deny]
```

Question and confirmation controls follow the same semantic model. Interaction controls use the
server-provided allowed actions/correlation and cannot be confused with ordinary waiting.

## Final answer

FinalAnswer renders below Work. During an active Turn it may show pending/streaming/absent state as
appropriate. Commentary is never shown as the final answer. Cancellation or failure preserves Work
and leaves FinalAnswer absent/partial only according to the canonical record.

## Temporary switch

- Expose a small Chat V1/V2 selector during migration.
- Selection is local UI representation state, not provider/session domain state.
- Switching does not restart, cancel, or mutate the Turn.
- Both views can inspect the same session for validation/fallback.
- V1 remains the safe fallback until Task 12 passes.
- V2 uses the new semantic projection even while individual providers are being enriched; missing
  optional semantics use server-owned neutral fallbacks.

## Validation corpus

Use sanitized provider fixtures and representative live sessions covering:

- long tool-heavy Work with dozens of operations;
- commentary between tools;
- reasoning plus commentary;
- one compound invocation with several actions;
- tool failure followed by recovery and successful Turn completion;
- permission request, question, and confirmation where supported;
- long-running operation and waiting for tool result;
- waiting for provider/model response with no active tool;
- cancellation, timeout, provider failure, process cleanup barrier, and interrupted/unknown recovery;
- final answer streaming/completion; and
- server/session reload and SSE reconnect.

Validate desktop and narrow/mobile widths, long titles, large details, expansion, active emphasis,
interaction accessibility, composer enablement, and switching between V1/V2 during an active Turn.

## Final cutover and cleanup

After Task 12 passes:

1. Make the semantic chat projection/renderer canonical.
2. Remove V1 projection and renderer.
3. Remove the representation switch and migration state.
4. Remove compatibility projection/storage/event adapters.
5. Remove obsolete model/event types and dead provider mappings.
6. Remove migration-only tests while retaining canonical regression scenarios.
7. Rename surviving `*V2` canonical symbols/files to unversioned names.
8. Update architecture documentation and the applicable ADR/superseding ADR.
9. Search relevant production code for case-insensitive `v1`, `v2`, `legacy`, `compat`, `oldChat`, and
   `newChat`; classify each match, remove migration matches, and record legitimate unrelated version
   strings in the task verification report.

The completed state is exactly one provider-neutral Turn model, one server chat projection, and one
chat implementation.
