# Area: Canonical persistence and server projection

## Purpose

Persist the canonical Turn aggregate and expose a semantic chat contract. The browser receives a
render-ready meaning model, not normalized provider protocol events that require further inference.

## Canonical persistence

Persistence stores durable session identity plus Turn records containing:

- Turn identity, start/update/end timestamps, current/terminal status, cause, initiator, and
  authoritative-completion summary;
- ordered Work items with stable sequence and type-specific content;
- ToolInvocation hierarchy, actions, statuses, timestamps/duration, details, and closure reason;
- Interaction status/response summary;
- separate FinalAnswer state/content;
- active provider-operation/recovery references needed for session readiness, excluding private raw
  payloads; and
- schema/version and persistence health metadata.

The diagnostic sidecar is not replayed to rebuild this state. No historical local transcript
migration is required; unreadable/old schema is reported as unavailable/unknown rather than
synthesized as an empty ready session.

Every accepted semantic event is applied idempotently. Applying an update changes the matching item
in place. Reload preserves Work sequence exactly. Terminal reconciliation retains Turn ID, outcome,
cause, initiator, unresolved Work closure reasons, and persistence evidence.

## Semantic server projection

The V2 projection returns, at minimum:

- session access/readiness: ready, busy, requires attention, historical/read-only, unavailable, or
  unknown, with a semantic reason;
- canonical Turn identity/status/outcome/cause and timestamps;
- ordered presentation-safe Work items;
- ToolInvocation with semantic title/kind/actions/status/progress and expandable technical details;
- pending/resolved Interaction with supported actions;
- separate FinalAnswer state/content;
- `workSummary` containing overall state, `activityCount`, current/latest meaningful activity,
  optional active-tool count, attention summary, and `expandable`; and
- SSE cursor/version needed for deterministic live replay.

`workSummary` is server-owned. The browser may choose labels/layout within UX requirements, but it
does not select the active tool, infer attention, count nested actions as activities, parse command
details, or reconstruct waiting from event absence.

## Live and reload equivalence

- Snapshot and SSE use the same canonical schema or one deterministic event/snapshot pair with a
  shared reducer contract.
- Live deltas carry stable Turn/Work/item identity and sequence.
- Reconnect replay is idempotent and cannot duplicate/reorder Work.
- A fresh snapshot after the same event prefix equals the live reducer's logical model.
- Provider/private diagnostic details never appear in API or SSE payloads.

## Temporary V1/V2 migration boundary

During migration, keep two chat projections/renderers only:

```text
canonical runtime + canonical persistence
  -> temporary V1 chat projection -> current chat renderer
  -> V2 semantic chat projection  -> new Work renderer
```

The temporary selection is explicit at the chat projection request/UI state boundary. It may use a
temporary query/route/projection discriminator chosen by Task 07, but it must be:

- scoped to chat representation, not provider/runtime behavior;
- able to show the same session in both representations;
- safe to switch without restarting/cancelling the active Turn;
- non-authoritative and not persisted as session domain state; and
- easy to delete as one bounded branch in Task 13.

Before canonical persistence fully lands, V1 may continue reading the existing projection. Once the
canonical store is active, V1 is a compatibility projection over canonical data, not a second write
pipeline. Provider mapping tasks always target the canonical model.

## API errors and readiness

The server distinguishes not-found, provider unavailable, read-only/historical, busy, requires
attention, persistence unavailable/corrupt, cleanup barrier, and unknown/lost ownership. UI
composer and controls consume this readiness contract directly. A failure to read or reconcile
state never becomes `idle` by catch-all fallback.

## Acceptance invariants

1. Browser types contain no provider protocol unions or raw provider IDs.
2. The same canonical Turn produces stable V1 and V2 projections during migration.
3. V1 projection cannot write or influence canonical lifecycle state.
4. Server projection, not UI, owns semantic current activity and attention.
5. Snapshot/replay/reload preserve the exact Work and nested-action ordering.
6. FinalAnswer remains separate and absent/pending when the provider has not supplied final phase.
7. Unknown persistence/recovery state is visible and blocks unsafe new-Turn actions.
