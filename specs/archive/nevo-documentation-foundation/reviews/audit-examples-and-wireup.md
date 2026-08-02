---
review-of: spec-audit
change: nevo-documentation-foundation
audit-focus: "Are the examples in this documentation set genuinely useful and wired end-to-end, or random/copy-pasted fragments?"
generated: 2026-08-02
verdict: changes-recommended
audit_status: open
unresolved_required_fixes: 3
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

## Revision note

First pass classified F2 (a cross-service, domain-grounded event example) as
`OWNER_DECISION` requiring new code under `examples/**`. The owner clarified in review:
no new example *project* is wanted — the ask is a better, domain-meaningful, honestly-
labeled **documentation** narrative that composes NEvo's real, already-shipped APIs
(`MapCommandEndpoint`, `ICommandDispatcher`, `IEventPublisher`, `IEventHandler<T>`), the
same way the package docs' "Basic usage" sections already compose illustrative snippets
— not a claim that a new runnable project exists. That reclassifies F2 from
`OWNER_DECISION` to `AUTO_FIX`: fixable in `docs/**` alone, no code changes, no separate
change/spec needed. F2 and F8 below reflect this.

# Review: nevo-documentation-foundation / whole-change examples & wire-up audit

## Scope note

This is a `/nevo-ai:spec-audit`, not a single-task `/nevo-ai:task-review` — see
`references/review-policy.md` § "Change-wide audits". The owner asked, in Polish, for a
review across the whole `nevo-documentation-foundation` change focused specifically on
one question: **are the examples in this documentation set genuinely useful and wired
end-to-end, or are they random/copy-pasted fragments — and where is "full wire-up"
missing?** All 13 tasks in this change are already `implemented`, each having separately
passed its own `/nevo-ai:task-review` against its own acceptance criteria. This audit
does not reopen or re-grade those per-task passes; it looks across all of them for a
different thing: example quality and end-to-end demonstrability.

No reliable previous-file baseline is available. Performing a fresh audit of the current
documentation-foundation implementation across all 13 tasks, with a focus on example
usefulness and wire-up completeness.

`verdict: changes-recommended` means: nothing here invalidates any task's already-passed
acceptance criteria, but concrete follow-up items are recommended before treating the
"example quality" goal as fully met. See "Handoff" at the end for what happens next, and
`audit_status: open` above until that follow-up is done.

## Headline answer to the owner's question

**The examples are not random or useless.** Every guide and package doc read for this
audit either cites a real test/example file for its code, or is clearly framed as a
minimal illustrative API-shape snippet (the package-doc template's own convention),
never presented as more than that. The ExampleApp walkthrough in particular is unusually
candid about what's fake (`FakeEventStore` persisting nothing, hardcoded roles, only the
password OAuth grant working) rather than hiding it. See F7.

**What's missing is the specific thing you asked about:** a demonstrable, end-to-end
"install → first request → handled by a command → publishes an event → event handled
somewhere else" story, told on a real, memorable domain instead of `Ping`/`Foo`. The
pieces for this all exist as real, working, individually-documented APIs — an HTTP
endpoint bound straight to a command dispatcher (`MapCommandEndpoint`, F8), a command
handler that publishes an event (F1, already running in `examples/ExampleApp` today,
just undocumented), and multiple independent handlers reacting to that event (F1). What
doesn't exist is a single guide that **strings them together** into one coherent,
domain-named walkthrough instead of the current three disconnected pieces (a
context-free `Ping` in quick-start, an undocumented event fan-out in the walkthrough,
and a scattering of unconnected `Order*` snippets across package docs, F4). Doc-only fix
— see F2 and F8.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | `docs/guides/example-app-walkthrough.md` Scenario 2 documents everything `SayHelloCommandHandler` does | It doesn't — the handler also publishes `MyEvent`, fanned out to two registered handlers; the guide never mentions this | `SayHelloCommandHandler.cs:14`: `return await eventPublisher.PublishAsync(new MyEvent(message.Foo), cancellationToken);`; `MyEventHandlerA.cs`/`MyEventHandlerB.cs` each implement `IEventHandler<MyEvent>` and just `Console.WriteLine`; both registered in `MessageHandlerRegistryExtensions.cs:13-14`. The walkthrough's Scenario 2 (`docs/guides/example-app-walkthrough.md:103-129`) covers only the permission-check path. | `docs/guides/example-app-walkthrough.md` § Scenario 2 |
| F2 | AUTO_FIX | changed *(reclassified — see Revision note)* | A single guide walks a reader through a domain-meaningful, end-to-end "HTTP request → command → handler → event → separate handler" story, composing NEvo's real APIs, honestly labeled as illustrative where it isn't literally an `examples/` project | No such guide exists. The closest material is `quick-start.md` (uses meaningless `Ping`, manual `IMessageProcessor` resolution — see F8 — and stops before any event), `example-app-walkthrough.md` Scenario 2 (real command + real event fan-out, but undocumented — F1), and 4 disconnected `Order*` snippets in package docs (F4) that never reference each other. Fixable entirely in `docs/**`: rewrite/extend `quick-start.md`'s later steps (after `NEvo.Messaging.Cqrs` is added) to (a) expose the handler over HTTP via `NEvo.Messaging.Web`'s real `MapCommandEndpoint<TCommand>` instead of stopping at manual dispatch, (b) have the handler publish a domain event via `IEventPublisher`, (c) show a second, independent `IEventHandler<T>` reacting to it, and (d) point out this is the exact shape already running in `examples/ExampleApp` (`SayHelloCommandHandler` → `MyEvent` → `MyEventHandlerA`/`B`, once F1 documents it) so the reader recognizes it, not a new unrelated example. No `examples/**` or `src/**` change needed — every API composed here (`MapCommandEndpoint`, `ICommandDispatcher`, `IEventPublisher`, `IEventHandler<T>`) already exists and is already individually documented. | `src/NEvo.Messaging.Web/RoutesExtensions.cs:46-65` (`MapCommandEndpoint` — real, confirmed used by `examples/ExampleApp/.../Routes.cs:12-16`); `docs/packages/NEvo.Messaging.md:89-153` (`IEventPublisher`/`IEventHandler<T>` API, already documented) | `docs/guides/quick-start.md` (primary target); cross-reference `docs/guides/example-app-walkthrough.md` (F1) |
| F3 | NON_BLOCKING | first-review | `docs/guides/extending-nevo.md`'s "Adding a handler" and "Adding an event type" sections cite a real example file the way "Adding a transport"/"Adding a persistence mechanism" cite `RestExternalMessageDispatchStrategy`/`IInboxDbContext` | They don't — both use generic, uncited `MyCommand`/`MyEvent` snippets, even though `examples/ExampleApp` already has a directly relevant, real, running analog (`SayHelloCommand`/`Handler`, `MyEvent`/`MyEventHandlerA`/`B`) that could have grounded them the same way | `docs/guides/extending-nevo.md:74-118` (generic snippets, no file citation) vs. `:31-72` (both cite real classes/files by name). Not an acceptance-criteria violation — task `developer-and-extension-guides`'s AC only requires citing the *package* by name, which both sections do (`NEvo.Messaging.Cqrs`, `NEvo.Messaging`'s Events namespace) — but it's an inconsistency in rigor within the same document. | `docs/guides/extending-nevo.md` §§ "Adding a handler", "Adding an event type" |
| F8 | AUTO_FIX | first-review | `docs/guides/quick-start.md` Step 3 ("Dispatch it") shows the realistic way a first request reaches a handler in a real service | It doesn't — it manually resolves `IMessageProcessor`/`IMessageContextProvider` from `app.Services` and calls `ProcessMessageAsync` directly inside `Program.cs`, a shape no real consumer uses to serve a request. The real, already-shipped, already-used-throughout-`ExampleApp` mechanism (`NEvo.Messaging.Web`'s `MapCommandEndpoint<TCommand>`, which maps an HTTP `POST` straight to `ICommandDispatcher.DispatchAsync`) is never mentioned in `quick-start.md` at all. Also, `Ping`/`"hello"` carries no domain meaning, unlike `SayHello`/`Document` in the walkthrough it hands off to. | `docs/guides/quick-start.md:53-59` (manual resolution) vs. `src/NEvo.Messaging.Web/RoutesExtensions.cs:46-65` (`MapCommandEndpoint`, real, used at `examples/ExampleApp/.../ServiceA.Api/Routes.cs:12-16`) | `docs/guides/quick-start.md` § "3. Dispatch it" |
| F4 | INFORMATIONAL | — | — | An "Order" domain motif already recurs, independently invented, across at least 4 package docs' illustrative snippets — none connected to each other or to any real code. This corroborates that an Order-domain worked example (F2) would fit naturally with documentation already written; today these are disconnected fragments, not evidence of a wired system. | `NEvo.Messaging.Cqrs.md:80` (`CreateOrder`/`CreateOrderHandler`), `NEvo.Authorization.md:102-105` (`OrderPermissionMapper`, `"orders:manage"`), `NEvo.Messaging.Authorization.md:147-155` (`OrderScopeValidator`, `"orders:create"`), `NEvo.Orchestrating.md:155-165` (`OrderOrchestrator`, `ReserveInventoryStep`, `ChargePaymentStep`, `ShipOrderStep`) | `docs/packages/NEvo.Messaging.Cqrs.md`, `NEvo.Authorization.md`, `NEvo.Messaging.Authorization.md`, `NEvo.Orchestrating.md` |
| F5 | INFORMATIONAL | — | — | Gating validation clean | `node tools/docs.mjs validate` → `Validated 42 documents — no errors.` (this run) | — |
| F6 | INFORMATIONAL | — | — | Change-wide constraint "no `src/**`/`tests/**`/`examples/**` file created or modified" holds for the whole branch, not just individual task diffs | `git diff --stat main...feature/nevo-documentation-foundation -- src tests examples` → empty output (this run) | — |
| F7 | INFORMATIONAL | — | — | No random/useless/copy-pasted-without-context fragment found in any guide or package doc read for this audit | Every code example either cites a real test/example file (`NEvo.Ddd.EventSourcing.md`'s `Document` snippet explicitly says "Adapted from `tests/NEvo.Ddd.EventSourcing.Tests/Fixtures/Document.cs`"; `extending-nevo.md`'s transport/persistence sections cite real classes) or is clearly framed as a minimal illustrative API-shape snippet per the package-doc template's own convention, never presented as runnable end-to-end. The `example-app-walkthrough.md` guide is unusually candid about what's fake: `FakeEventStore` persists nothing (Scenario 3), only the password OAuth grant works (Scenario 1), every token carries 3 hardcoded roles (Scenario 1), `ServiceB`'s dispatch endpoint is unauthenticated (Scenario 4). | `docs/guides/*.md`, `docs/packages/*.md` (all read this run) |

`node tools/docs.mjs check` (non-gating, repository-wide index staleness) also passed
("Indexes are current.") — recorded as informational per policy, not a factor in the
verdict either way.

## Scope compliance

Read-only audit; no files under review were modified. Confirmed via `git diff --stat
main...feature/nevo-documentation-foundation -- src tests examples` that the entire
branch (all 13 tasks combined) touched none of `src/**`, `tests/**`, `examples/**` —
consistent with every individual task's `forbidden_paths` and the change-wide
constraint in `overview.md`.

## Acceptance-criteria coverage

Not re-evaluated here — each task's own acceptance criteria were already checked by its
own prior `/nevo-ai:task-review` run (all 13 currently `implemented`). This audit adds
findings **outside** those criteria's literal text (see F1's note that it isn't an AC
violation), at the owner's explicit request for a different lens.

## Architecture and documentation

No architecture-doc drift found. `docs/architecture/event-sourcing.md`,
`messaging-pipeline.md` remain consistent with what the guides describe. F2's gap is a
gap in *examples/*, not in architecture documentation — nothing in `docs/architecture/`
claims a cross-service event example exists.

## Handoff

All three actionable findings (F1, F2, F8) are `docs/**`-only — no `examples/**` or
`src/**` change needed, no separate change/spec required. They read as one connected
story rather than three independent fixes:

1. **F8** — rewrite `quick-start.md` Step 3 to route through `NEvo.Messaging.Web`'s
   real `MapCommandEndpoint<TCommand>` (HTTP → `ICommandDispatcher`) instead of manual
   `IMessageProcessor` resolution, once the guide reaches the `NEvo.Messaging.Cqrs` step
   — this is the realistic "first request" path, and it's already how every endpoint in
   `examples/ExampleApp` works.
2. **F2** — extend that same walkthrough one step further: the handler publishes a
   domain event (`IEventPublisher`), a second, independent handler reacts to it
   (`IEventHandler<T>`), and the guide explicitly says "this is the same shape as
   `examples/ExampleApp`'s `SayHelloCommandHandler` → `MyEvent`" — turning quick-start
   into the actual end-to-end narrative the owner asked for, using only real, existing,
   already-documented APIs.
3. **F1** — document that exact existing shape in `example-app-walkthrough.md`'s
   Scenario 2, so the cross-reference in step 2 above points at something real and
   findable, not an unstated claim.

Suggested order: F1 first (it's the smallest, purely additive, and gives F2 something
concrete to point to), then F8+F2 together as one quick-start revision (they touch the
same section and the same narrative arc).

Recommend one new follow-up task in this change (e.g.
`quickstart-end-to-end-narrative`, `allowed_paths: docs/guides/quick-start.md,
docs/guides/example-app-walkthrough.md`) covering all three, rather than three separate
edits — the value here is specifically in the story connecting them, not in each fix
in isolation.

**Report:** `specs/active/nevo-documentation-foundation/reviews/audit-examples-and-wireup.md`
