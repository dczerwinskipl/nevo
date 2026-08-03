---
id: project.known-issues
type: project
title: Known issues
status: current
summary: >
  Central, scannable list of confirmed defects and gaps across NEvo packages. Every
  entry was previously documented only inside an individual package doc's Limitations
  section; this document consolidates them into one place.
---

# Known issues

Each entry: affected feature, current behavior, practical consequence, intended
behavior (if known), severity/usage recommendation, source location, and related
spec/task where applicable. This is a documentation-accuracy list, not a
code-fix backlog — fixing any of these is out of scope for the change that created this
document (see `specs/active/nevo-documentation-architecture/overview.md` § "Out of
scope").

## Authorization surfaces a generic HTTP 500, not 403

- **Affected feature:** `NEvo.Messaging.Authorization`'s permission enforcement, exposed
  over HTTP via `NEvo.Messaging.Web`.
- **Current behavior:** `ValidatePermissionMiddleware` returns a `Left` on
  permission-denied. `NEvo.Messaging.Web`'s `MapMessagesEndpoints`/`MapCommandEndpoint`
  map **every** `Either.Left` — including a permission-denied failure — to the same
  generic `Results.Problem(statusCode: 500)`.
- **Practical consequence:** A client cannot distinguish "you don't have permission"
  from any other server-side failure by status code alone.
- **Intended behavior:** Not specified anywhere in the codebase — no `403`-mapping
  design exists yet.
- **Severity / usage recommendation:** If your API needs a `403 Forbidden`, add your own
  result-handling layer that inspects the exception message/type before it reaches
  `NEvo.Messaging.Web`'s default mapping.
- **Source:** `NEvo.Messaging.Authorization` (validation-failure behavior),
  `NEvo.Messaging.Web` (endpoint mapping).
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## `AllowPermissionAttribute.PermissionName` is not checked

- **Affected feature:** `[AllowPermission(name, validatorType)]` permission enforcement.
- **Current behavior:** `ValidatePermissionMiddleware` iterates every permission the
  current user has and calls your supplied validator's `Validate(...)` for each; access
  is granted the moment any permission validates. `PermissionName` itself is never
  compared against the user's permission names by this middleware — matching is defined
  entirely by your own validator.
- **Practical consequence:** Declaring `[AllowPermission("orders:create", ...)]` does
  not, by itself, restrict access to users holding a permission named `"orders:create"`
  — a validator that ignores the permission's name will grant access based on other
  criteria alone.
- **Intended behavior:** Unclear — the attribute's own shape suggests `PermissionName`
  should gate access, but no enforcement path does this.
- **Severity / usage recommendation:** Treat `PermissionName` as documentation/metadata,
  not enforcement, unless your own validator implementation explicitly checks
  `permission.Name`.
- **Source:** `NEvo.Messaging.Authorization`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## The default event store is a non-functional stub

- **Affected feature:** `NEvo.Ddd.EventSourcing`'s `AddEventSourcing()` DI registration.
- **Current behavior:** The default `IEventStore` registered is `FakeEventStore`:
  `AppendEventsAsync` does nothing and reports success; `LoadAggregateAsync`/
  `LoadProjectionAsync` always return "not found."
- **Practical consequence:** Using `AddEventSourcing()` as-is silently discards every
  event — commands appear to succeed but nothing is persisted, and nothing can be loaded
  back.
- **Intended behavior:** A consumer is expected to register a real `IEventStore`
  implementation (the registration uses `TryAddScoped`, so overriding it is supported)
  — but no real implementation ships anywhere in this repository today.
- **Severity / usage recommendation:** Do not rely on `AddEventSourcing()`'s default
  wiring for anything beyond exercising the decide step. Write and register your own
  `IEventStore` before using event sourcing for real persistence.
- **Source:** `NEvo.Ddd.EventSourcing`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## No orchestration-state persistence implementation exists

- **Affected feature:** `NEvo.Orchestrating`'s `IOrchestratorStateRepository` /
  `PersistentStepExecutor` resumability mechanism.
- **Current behavior:** No class anywhere in this repository implements
  `IOrchestratorStateRepository`. `NEvo.Orchestrating.EntityFramework` provides only an
  EF entity shape and a table configuration, not a working repository.
  `OrchestrationManager.RunAsync`'s call to save initial state, and `CompleteAsync`'s
  fetch of prior state, are both commented out / stubbed in source.
- **Practical consequence:** `PersistentStepExecutor` cannot make orchestration progress
  resumable today; `OrchestrationManager.CompleteAsync` throws a
  `NullReferenceException` if called as written.
- **Intended behavior:** A real EF-backed (or other) `IOrchestratorStateRepository`
  implementation, wired into both the initial-save and resumption paths.
- **Severity / usage recommendation:** Do not use `PersistentStepExecutor` or
  `OrchestrationManager.CompleteAsync` expecting working persistence — write your own
  `IOrchestratorStateRepository` implementation first.
- **Source:** `NEvo.Orchestrating`, `NEvo.Orchestrating.EntityFramework`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## `OrchestratorStateTypeConfiguration` configures the wrong entity type

- **Affected feature:** `NEvo.Orchestrating.EntityFramework`'s EF model configuration.
- **Current behavior:** `OrchestratorStateTypeConfiguration` implements
  `IEntityTypeConfiguration<OrchestratorState>` (`NEvo.Orchestrating`'s own non-generic
  base class), not `IEntityTypeConfiguration<OrchestratorStateEf>` (this package's own
  EF-mapped entity). Nothing in the package maps between the two shapes.
- **Practical consequence:** Applying this configuration does not configure
  `OrchestratorStateEf`, the type this package actually intends to persist — the
  configuration and the entity are disconnected.
- **Intended behavior:** A single, correctly-typed EF configuration for
  `OrchestratorStateEf`.
- **Severity / usage recommendation:** Do not assume applying
  `OrchestratorStateTypeConfiguration` gives you working EF mapping for orchestrator
  state — see "No orchestration-state persistence implementation exists" above; this is
  part of the same overall gap.
- **Source:** `NEvo.Orchestrating.EntityFramework`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## Outbox is missing locking, partitioning, and a DI helper

- **Affected feature:** `NEvo.Messaging.EntityFramework`'s `EntityFrameworkMessageOutbox`.
- **Current behavior:** No `AddEntityFrameworkOutbox<TDbContext>()` DI helper exists
  (only inbox has one). `GetMessagesToPublishAsync` and `SaveMessageAsync` both carry
  `// TODO` comments for locking (concurrent readers could race for the same messages)
  and partitioning (`SaveMessageAsync` hardcodes partition `0`). Context-header
  serialization is unimplemented — `GetMessagesToPublishAsync` returns empty headers for
  every message regardless of what was saved.
- **Practical consequence:** A consumer must register `IMessageOutbox` manually; a
  background publisher polling this outbox has no protection against two readers
  processing the same message concurrently, and cannot rely on partition assignment or
  on the original message context headers being preserved.
- **Intended behavior:** A DI helper matching the inbox's, real locking, real partition
  assignment, and preserved context headers.
- **Severity / usage recommendation:** Register `IMessageOutbox` manually. Do not run
  multiple concurrent outbox publishers without your own locking. Do not rely on
  partition-based ordering guarantees or on context headers surviving an outbox
  round-trip.
- **Source:** `NEvo.Messaging.EntityFramework`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## `RestClientServiceBase.GetAsync` puts query parameters in the request body

- **Affected feature:** `NEvo.Web`'s `RestClientServiceBase.GetAsync<TResponse>`.
- **Current behavior:** `GetAsync` puts `queryParams` in the request body via
  `FormUrlEncodedContent`, not the URL query string. `PostAsync` correctly uses
  `QueryHelpers.AddQueryString` for the same parameter.
- **Practical consequence:** A `GetAsync` call with `queryParams` will not produce the
  query string a caller likely expects — an HTTP GET request with a body is also
  non-standard and may be rejected or stripped by some servers/proxies.
- **Intended behavior:** `GetAsync` should place `queryParams` in the URL query string,
  matching `PostAsync`'s approach.
- **Severity / usage recommendation:** Likely unintentional — confirm this is what you
  want before relying on `GetAsync` with query parameters.
- **Source:** `NEvo.Web`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## `AllowPermissionAttribute`'s validator-type check is disabled

- **Affected feature:** `[AllowPermission(name, validatorType)]`'s constructor-time
  validation.
- **Current behavior:** The constructor's check that `validatorType` implements
  `IDataScopeMessageValidator<,>` is commented out in source (`// TODO fix that,
  something from with generics`).
- **Practical consequence:** Supplying an incorrect `validatorType` is not caught at
  attribute-declaration time — `ValidatePermissionMiddleware` instead throws at runtime,
  the first time the handler actually runs, when it tries to construct the type via
  `ActivatorUtilities.CreateInstance`.
- **Intended behavior:** A compile-time or attribute-construction-time check that
  `validatorType` actually implements the required interface.
- **Severity / usage recommendation:** Double-check `validatorType` by hand when adding
  `[AllowPermission]` — an incorrect type surfaces only at first invocation, not at
  startup or compile time.
- **Source:** `NEvo.Messaging.Authorization`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## `AggregateEvolver`'s evolver map does not rebuild across instances

- **Affected feature:** `NEvo.Ddd.EventSourcing`'s `AggregateEvolver`.
- **Current behavior:** The evolver map is a `static` field, lazily built via `??=` from
  whichever `AggregateEvolver` instance is constructed first with its `aggregateTypes`
  array. Constructing a second `AggregateEvolver` with a *different* set of aggregate
  types does not rebuild the map — it silently keeps the first instance's set.
- **Practical consequence:** In a process that constructs more than one
  `AggregateEvolver` with different aggregate-type sets, the second (and later)
  instances silently evolve against the wrong/incomplete type map.
- **Intended behavior:** Per-instance evolver maps, or a DI-registered registry (source
  itself has a `// TODO: add DI with some registry?` comment acknowledging this).
- **Severity / usage recommendation:** Only construct one `AggregateEvolver` per
  process, covering every aggregate type you need.
- **Source:** `NEvo.Ddd.EventSourcing`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## A persistently failing migration takes the whole host down

- **Affected feature:** `NEvo.EntityFramework`'s `MigrationBackgroundService<TDbContext>`.
- **Current behavior:** On startup, migrations are retried up to 10 times with linear
  backoff (1-10s). If all 10 attempts fail, the exception propagates out of
  `ExecuteAsync` uncaught — for a `BackgroundService`, this stops the whole host (default
  ASP.NET Core/.NET Generic Host behavior since .NET 6).
- **Practical consequence:** A persistently failing migration takes the application
  down; there is no configurable "log and continue" mode.
- **Intended behavior:** Not specified — this may be the intended fail-fast behavior for
  a framework this early, but it's not stated as a deliberate design choice anywhere.
- **Severity / usage recommendation:** Be aware that a migration failure is fatal to
  startup, not a background warning, when relying on `AddMigrationWorker<TDbContext>()`.
- **Source:** `NEvo.EntityFramework`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## A failed HTTP response's body is discarded

- **Affected feature:** `NEvo.Web`'s `HttpClientServiceBase.SendAsync`.
- **Current behavior:** The error branch has a `// TOOD: add some extractor for details
  of error` comment — a non-success response's body is discarded; only the status code
  reaches the resulting `HttpRequestException` message.
- **Practical consequence:** Callers cannot see the failed response's body (e.g. a
  downstream API's structured error details) through this wrapper.
- **Intended behavior:** Extract and surface the response body's error detail.
- **Severity / usage recommendation:** If you need the failed response body, don't rely
  on `HttpClientServiceBase.SendAsync`'s error wrapping alone.
- **Source:** `NEvo.Web`.
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## Example app: ServiceB's internal dispatch endpoint is unauthenticated

- **Affected feature:** `examples/ExampleApp`'s cross-service dispatch scenario
  (`ServiceB.Api`'s `/api/messages/dispatch` endpoint).
- **Current behavior:** `ServiceB`'s `/api/messages/dispatch` endpoint (the receiving
  side of `ServiceA`'s cross-service dispatch) has no `.RequireAuthorization()` call —
  unlike `ServiceA`'s equivalent — so this internal dispatch path is unauthenticated in
  this example.
- **Practical consequence:** Any caller that can reach `ServiceB` directly can invoke
  this endpoint without a token, bypassing the authorization exercised elsewhere in the
  walkthrough.
- **Intended behavior:** Not stated — this is example-app configuration, not framework
  behavior; a real deployment would need its own decision about internal-endpoint
  authentication (e.g. network isolation, service-to-service auth).
- **Severity / usage recommendation:** Example-app-scoped gap, not a framework defect.
  Do not copy this endpoint's lack of authorization into a real service without an
  explicit decision to do so.
- **Source:** `docs/usage/example-app-walkthrough.md` (Scenario 4).
- **Related spec/task:** First documented by the archived `nevo-documentation-foundation` change.

## Excluded: example app's hardcoded roles (intentional simplification, not a defect)

Every token issued by the example app's Identity service carries 3 hardcoded roles
(Manager, Admin, Invalid), regardless of which user authenticated — marked
`// hardcoded for testing` in source (`Routes.cs`). This is an **intentional
simplification** for the walkthrough (so the guide can talk about "the Admin role"
without a separate role-assignment step), not a defect, and is not listed as an issue
above.
