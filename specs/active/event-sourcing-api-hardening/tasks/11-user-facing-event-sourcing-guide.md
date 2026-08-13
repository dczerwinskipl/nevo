---
id: event-sourcing-api-hardening.user-facing-event-sourcing-guide
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
  - es-command-executor-and-ambiguity-resolution
  - explicit-event-sourced-command-handler
  - primary-fallback-handler-roles
  - event-sourcing-registration-options
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
  - documents-example-es-and-auth-demo
  - aggregate-decision-method-parameter-injection
  - current-user-capability-and-documents-integration
  - typed-authorization-failure-and-403-mapping
  - query-either-ergonomics-cleanup
semantic_references:
  decisions: [D13, D17, D18, D20, D21, D22, D23, D24, D25, D28, D29, D31, D33, D34, D35, D36, D37, D38, D39, D42, D43, D44]
  dependency_contracts:
    - harden-event-store-and-repository-contracts
    - es-command-executor-and-ambiguity-resolution
    - explicit-event-sourced-command-handler
    - primary-fallback-handler-roles
    - event-sourcing-registration-options
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
    - documents-example-es-and-auth-demo
    - aggregate-decision-method-parameter-injection
    - current-user-capability-and-documents-integration
    - typed-authorization-failure-and-403-mapping
    - query-either-ergonomics-cleanup
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/user-facing-documentation.md
    - specs/active/event-sourcing-api-hardening/overview.md
    - docs/usage/README.md
    - docs/usage/commands.md
    - docs/usage/queries.md
    - docs/usage/authorization.md
    - docs/usage/choosing-packages.md
    - docs/usage/example-app-walkthrough.md
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/
  optional:
    - docs/usage/quick-start.md
allowed_paths:
  - docs/usage/event-sourcing.md
  - docs/usage/README.md
  - docs/usage/queries.md
  - docs/usage/choosing-packages.md
  - docs/usage/example-app-walkthrough.md
forbidden_paths:
  - src/**
  - examples/**
  - docs/development/**
---

# Task: User-facing Event Sourcing guide (`docs/usage/event-sourcing.md`)

## Goal

Write `docs/usage/event-sourcing.md` — a single comprehensive consumer guide, following
this repository's established `docs/usage/*.md` flat-file convention (`type: guide`,
matching `commands.md`/`events.md`/`authorization.md` in shape, not a new subdirectory
structure), covering every topic listed below with concrete, testable acceptance
criteria — not "update docs where appropriate." A developer using NEvo must be able to
answer every question in "Required reader questions" below from this guide alone,
without reading framework source.

This is a first-class deliverable of this specification (external review, review
issue: "Documentation is a first-class deliverable, not an implementation note"), not
an afterthought bolted onto the internal architecture doc (task 12 owns that, kept
separate for a different audience).

## Dependencies

Every functional task in this change (02-07, 09-10, 13-16) — this guide documents their
shipped, final shape. Sequenced last alongside task 12.

## Implementation constraints

- File: `docs/usage/event-sourcing.md`. Front matter: `id: guides.event-sourcing`,
  `type: guide`, `title: Event Sourcing`, `status: current`, plus a `summary:` — matching
  `docs/usage/commands.md`'s exact front-matter shape (`REQUIRED_FIELDS.guide` in
  `tools/docs/service.mjs`: `id`, `type`, `title`, `status`, `summary`).
- Add a row for it to `docs/usage/README.md`'s guide table (after "Authorization,"
  before "Troubleshooting," matching that table's rough dependency-order shape).
- Use the Documents example service (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/`,
  tasks 09-10) as the canonical walkthrough referenced throughout — link to specific
  files/commands in it rather than inventing separate illustrative code samples where
  the real example already demonstrates the point.
- State plainly, in the modeling section, that the current object-oriented immutable
  aggregate-state style is the **currently supported/default** modeling approach, not a
  permanent restriction of the Event Sourcing core (D17) — a short "future modeling
  styles" note (one paragraph) is sufficient; do not document mutable or static/
  functional models as implemented features, because they are not implemented.
- The projections/read-side section documents the current intermediate read path
  honestly (Query → QueryHandler → AggregateRepository → DTO) and states, in one short
  subsection or a clearly labeled note, that persisted projections are a future
  specification's scope — do not write speculative "how to implement projections"
  content as if it exists today.
- Update `docs/usage/queries.md` to reference `MapQueryEndpoint` (task 08's addition) as
  the recommended HTTP Query pattern, replacing/supplementing its current manually-wired
  `MapGet` example.
- Update `docs/usage/choosing-packages.md` and `docs/usage/example-app-walkthrough.md`
  if they describe the pre-refactor Document example location/shape (`ServiceA.Api`
  rather than the new `NEvo.ExampleApp.Documents.Api`) — small, targeted corrections,
  not a rewrite of either document.

## Required sections (each maps to a required-questions group below)

1. **Overview / mental model** — what NEvo Event Sourcing provides, what the framework
   owns vs. what the application owns, the command → decision → domain event →
   evolution → new state relationship, the OO-immutable style as current default (D17).
2. **Configuration** — `AddEventSourcing(options => {...})` (task 06), aggregate/handler
   discovery, the convention-fallback toggle and what disabling it does/doesn't affect,
   any registration requirements for repositories/stores, interaction with
   `AddMessages()`/`AddCommands()`.
3. **Modeling aggregates** — identity, concrete lifecycle states, immutable
   transitions, deciding from a command, evolving from an event, replay, same-command-
   on-multiple-states resolution (most-specific-wins, task 03), domain invariants vs.
   application/security concerns, when concrete state types are useful vs. excessive.
4. **Command handling choices** — all three levels, explicitly **when to use each**
   (a decision table or equivalent), what plumbing NEvo provides for each, and how
   Level 2 represents "existing aggregate" vs. "creation" explicitly via
   `Option<TAggregate>` (`Some`/`None`, D24) rather than assuming one or the other. State
   the decision boundary plainly: Level 2 manages exactly one Event Sourced aggregate
   write per command and may read other data freely for orchestration; a use case
   needing coordinated writes across two or more independently-versioned aggregate
   streams belongs to Level 3 or a future saga/process-manager capability (D31) — frame
   Level 3 as "the right tool for anything that doesn't fit," never as an inferior or
   legacy option. Also cover **decision-method parameter injection** (task 13, D34,
   D38, D39, D42, D44): a Level 1 decision method — both a `static` creation method and an
   instance method on existing state — may declare additional, framework-resolved
   parameters after the command (e.g. `ICurrentUser<Guid, TUser>`, or a business-policy type),
   resolved from the current invocation's scope, not a general service-locator (no
   `IServiceProvider` parameter is ever supported); the single-command-parameter form
   keeps working unchanged. State plainly that **every declared parameter is required**
   (D42) — declaring one is the assertion "this decision needs this contextual fact";
   the framework resolves it or does not invoke the decision method at all. State the
   **required-contextual-dependency invariant** plainly (D44): a required dependency must
   be successfully resolved *and validated* during resolution/activation — a dependency
   that resolves as a type but only fails once the decision method starts running is an
   application failure, not a parameter-resolution failure — so a resolution failure is
   never turned into `null`/`Option.None` passed to the method, and the decision method is
   never entered without every declared parameter genuinely available.
   State the **supported-use contract** plainly (D39): additional parameters represent
   already-available contextual facts or synchronous, side-effect-free business policies
   (`ICurrentUser<Guid, TUser>`, `IClock`, a precomputed policy object) — orchestration or
   external I/O (a `DbContext`, an `HttpClient`, a service that calls out) belongs to an
   explicit `IEventSourcedCommandHandler<...>` (Level 2) instead, which remains fully
   supported for exactly that purpose (D33).
5. **Handler registration and fallback semantics** — Primary/Fallback (task 05),
   convention = Fallback, explicit/ordinary handlers = Primary, duplicate-Primary
   failure, why no numeric priority.
6. **Authorization and permissions** — operation permission on the message,
   handler-specific additional requirement (AND) — both enforced entirely by the
   messaging pipeline, before Event Sourcing execution even begins — and
   aggregate/resource-aware authorization after rehydration (task 07), which is the
   *only* authorization concern Event Sourcing itself owns and which sees the same
   explicit `Some`/`None` current-state distinction as Level 2 (D24-D25). Domain
   invariant stays in the decision method. Explicit guidance against duplicating
   permission attributes across concrete state methods. Also cover the **HTTP
   consequence** (task 15, D36): an unauthenticated request is rejected with 401 by the
   existing ASP.NET authentication/authorization gate before NEvo's own checks run; an
   authenticated request denied by a NEvo permission check returns 403 via a typed
   `PermissionDeniedException`; any other unexpected failure returns 500 — and
   `ICurrentUser<TId, TUser>` (task 14, D35, D42, D44): an identity-only, **required**
   capability (`TUser User`, never `Option`-wrapped) a decision method may request via
   parameter injection. State the required-contextual-dependency invariant plainly
   (D44): a missing current user fails while the capability itself is being resolved/
   activated — before the decision method is invoked at all, not from a value the
   aggregate reads and must check — so the aggregate is never entered without one,
   distinct from and never a substitute for the authorization pipeline itself.
7. **Persistence and concurrency** — Event Store vs. repository responsibilities
   (task 02), replay, stream version (out-of-band, not an envelope field),
   optimistic concurrency, `AggregateConcurrencyException` **returned** via `Either`
   (never thrown — D13). Explain the create-vs-update mental model plainly: creating a
   new aggregate expects no existing stream, updating an existing one expects it to be
   at exactly the version last observed — no unconditional/"don't check" append mode and
   no automatic retry after a conflict exists (D29); this is a concept-level explanation
   for readers, not a requirement to name the internal expected-stream-state type.
   Explain the three distinct layers plainly (D20-D22): the
   domain event payload (unchanged `Event : Message`), runtime message-processing
   context (`IMessageContext`, already carrying correlation/causation), and a future
   provider's own persisted representation — **no envelope type exists in this
   version of NEvo**, and none is implied as coming "soon." Explain append/flush vs.
   final commit as the storage-contract guarantee (D23): append succeeds → visible to
   synchronous downstream processing → does not imply final transaction commit; cite
   the real `SaveChangesAsync` pattern already used by inbox/outbox, not a claim that
   no flush mechanism exists. State plainly that a real persistence provider is a
   follow-up specification's work, and that this version does not freeze the final
   store SPI (D22).
8. **Query/read side** — the intermediate `Query → QueryHandler → AggregateRepository →
   DTO` path (now shown using `RequireSome`/`.Map`, task 16, D37, not the earlier
   `MapAsync` shape), `MapQueryEndpoint` usage and GET route/query-string binding (D18 —
   state plainly that `Id`/`CreatedAt` are never required GET parameters and why),
   explicit "not the final recommendation for complex read models" framing, and the
   future projections direction-only note.
9. **Example** — link to `NEvo.ExampleApp.Documents.Api` and its walkthrough note
   (task 10) as the canonical sample.

## Acceptance criteria

1. `docs/usage/event-sourcing.md` exists with valid `type: guide` front matter and
   passes `node tools/docs.mjs validate` (automated).
2. Every one of the 9 required sections above is present with concrete, non-hand-wavy
   content — not a stub or a "TODO" placeholder (inspection).
3. `docs/usage/README.md`'s guide table includes a row for the new guide (inspection).
4. `docs/usage/queries.md` references `MapQueryEndpoint` as the recommended HTTP Query
   pattern (inspection).
5. Neither this guide nor any updated file documents mutable aggregates, static/
   functional deciders, or persisted projections as implemented features — a search for
   speculative "how to" content describing unimplemented capabilities as available
   returns nothing (inspection).
6. **Required reader questions** — a reviewer can locate, in this guide alone, a direct
   answer to each of the following (inspection, checked one by one against the
   published guide):
   - How do I configure Event Sourcing?
   - How do I write the currently supported aggregate model?
   - How do commands produce events?
   - How does replay evolve state?
   - How do I model a state transition such as Editable → Approved?
   - How do I use the default convention handler?
   - When do I use an explicit Event Sourced handler?
   - When do I use a normal `ICommandHandler<T>`?
   - How does handler fallback work?
   - Where do permissions belong?
   - How do resource-aware permissions work?
   - What HTTP status does a request get when it's unauthenticated vs. authenticated-
     but-denied vs. an unexpected failure?
   - How can a decision method receive the current user or another framework-resolved
     dependency?
   - How does optimistic concurrency work?
   - What does append/flush guarantee?
   - How do I expose/read an aggregate through Query today?
   - How do I map Query as HTTP GET?
   - What Event Sourcing capabilities are intentionally not implemented yet?
7. `node tools/docs.mjs validate` and `node tools/docs.mjs check` pass (automated).

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task is entirely documentation impact.

## Out of scope

- Internal/maintainer architecture documentation (task 12 — kept in
  `docs/development/event-sourcing.md`, a separate audience).
- Any speculative documentation of projections, mutable aggregates, or functional
  deciders as implemented capabilities.
- Rewriting `docs/usage/README.md`, `docs/usage/queries.md`, `docs/usage/
  choosing-packages.md`, or `docs/usage/example-app-walkthrough.md` beyond the targeted
  additions/corrections named above.
