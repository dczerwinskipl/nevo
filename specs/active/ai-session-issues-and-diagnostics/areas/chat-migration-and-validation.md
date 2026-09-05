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

## Work UX presentation

The collapsed indicator, expanded timeline, and Work Details surface rendered inside this switch are
defined in full by `areas/work-ux-presentation.md` (three-level model, current-activity projection,
no-duplication invariant, mobile requirements, icon vocabulary). Both V1 and V2 host that presentation;
V1 may use its existing simpler rendering, but V2 must implement the three-level model exactly —
switching representations must never change which canonical data is available, only how it is shown.

## Requires attention

Interaction rendering (permission/question/confirmation) follows `areas/work-ux-presentation.md`
§ "Level 1 — Work indicator" and its chronological placement in the Level 2 timeline. Both V1 and V2
must present the same pending Interaction consistently, using the server-provided allowed
actions/correlation, so switching representations never loses or misrepresents a blocking action.
Crucially, an `Interaction` is strictly created from structured provider protocol events (such as
Claude `AskUserQuestion`, Antigravity `ask_question`, or Codex `requestUserInput`), never inferred
from question marks or prose punctuation in normal assistant text. A normal conversational question
ending a Turn remains standard assistant output (FinalAnswer).

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
