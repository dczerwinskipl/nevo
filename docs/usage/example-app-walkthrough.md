---
id: guides.example-app-walkthrough
type: guide
title: ExampleApp walkthrough
status: current
summary: >
  End-to-end guide to examples/ExampleApp's 5 projects: auth, a permission-checked
  command that also publishes an event to two independent handlers, the Document
  event-sourcing flow (and why it doesn't actually persist anything by default), and
  cross-service dispatch.
---

# ExampleApp walkthrough

`examples/ExampleApp` is the primary way to see NEvo's pieces working together — it is
also, in places, unfinished or misleading if taken at face value. This guide states
what's actually there, cites the file for every claim, and calls out where behavior
doesn't match what you'd reasonably expect.

## Goal

Run the 5 `examples/ExampleApp` projects together and exercise: registration and OAuth
token issuance, a permission-checked command, the event-sourcing "decidable" flow, and
cross-service message dispatch.

## Prerequisites

See `docs/development/local-setup.md` — SQL Server (or LocalDB) and the .NET Aspire
workload are both required; this guide doesn't repeat those steps.

## The 5 projects

| Project | Role |
|---|---|
| `NEvo.ExampleApp.Identity.Api` | OAuth2/OpenID token server (ASP.NET Core Identity + OpenIddict) |
| `NEvo.ExampleApp.ServiceA.Api` | Main demo service: permission-checked commands, event sourcing, cross-service dispatch |
| `NEvo.ExampleApp.ServiceB.Api` | Receives dispatched commands from ServiceA |
| `NEvo.ExampleApp.Orchestration.AppHost` | .NET Aspire host — runs all of the above together, plus a shared SQL Server container |
| `NEvo.ExampleApp.Orchestration.ServiceDefaults` | Shared OpenTelemetry/health-check/service-discovery wiring, referenced by the 3 API projects |

**Naming note:** "Orchestration" here is .NET Aspire's service-topology orchestration
(running multiple services together for local dev) — unrelated to
`docs/reference/packages/NEvo.Orchestrating.md`'s saga orchestration. Neither
`NEvo.Orchestrating` nor `NEvo.Orchestrating.EntityFramework` is used anywhere in
`examples/ExampleApp`.

## Running the full set

`NEvo.ExampleApp.Orchestration.AppHost/Program.cs` defines the topology: a SQL Server
container (`.WithDataVolume()`, persistent lifetime) with 3 databases
(`IdentitySql`, `ServiceASql`, `ServiceBSql`), the `Identity` project, `ServiceB`
(waits for `Identity`), and `ServiceA` (waits for `Identity` and `ServiceB`). Each
service that needs it gets `IdentityUrl` injected as an environment variable pointing
at the Identity service's HTTPS endpoint.

```bash
dotnet run --project examples/ExampleApp/NEvo.ExampleApp.Orchestration/NEvo.ExampleApp.Orchestration.AppHost
```

The exact Aspire dashboard URL/port, and whether any additional local configuration
(connection strings, certificates) is needed beyond what Aspire provisions
automatically, depends on your local Aspire/Docker setup — watch the console output
when running the command above; Aspire prints the dashboard URL there.

The SQL Server admin password is hardcoded in `Program.cs`
(`ParameterResource("sqlServerPassword", ...)`) — fine for local dev, not something to
carry into any other environment.

## Scenario 1: register and get a token

`Identity.Api` exposes `POST /register` (`Routes.cs`) and `POST /connect/token`
(OpenIddict). Register a user, then request a token:

```bash
curl -X POST https://localhost:<identity-port>/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"P@ssw0rd!"}'

curl -X POST https://localhost:<identity-port>/connect/token \
  -d "grant_type=password&username=alice&password=P@ssw0rd!"
```

**Only the password grant is actually implemented.** `Program.cs` calls
`AllowClientCredentialsFlow()` and `AllowRefreshTokenFlow()`, but `Routes.cs`'s
`/connect/token` handler checks `IsPasswordGrantType()` only — every other grant type
falls through to `Results.BadRequest(UnsupportedGrantType)`. Do not expect
client-credentials or refresh-token requests to work against this example, despite
being "allowed" in the OpenIddict server configuration.

**Every issued token carries 3 hardcoded roles**, regardless of which user
authenticated (`Routes.cs`, marked `// hardcoded for testing`):

```
{ "name": "Manager", "dataScope": { "tenantId": "T1", "companyId": "*" } }
{ "name": "Admin",   "dataScope": { "tenantId": "T1", "companyId": "C1" } }
{ "name": "Invalid", "dataScope": { "companyId": "C1" } }
```

This is an intentional simplification for this walkthrough, not a defect — it lets
this guide talk about "the Admin role" or "the Manager role" without a separate
role-assignment step, since every registered user already has all 3.

## Scenario 2: a permission-checked command

`ServiceA.Api` maps `POST /api/hello` (requires authorization) and
`/api/hello_noAuth` (does not) to `SayHelloCommand`
(`ExampleDomain/SayHelloCommand.cs`, `Routes.cs`). The authorized path exercises the
full `docs/reference/packages/NEvo.Messaging.Authorization.md` chain:

- `SayHelloCommandHandler` is annotated `[AllowPermission(Permissions.SayHello,
  typeof(SayDataScopeValidator<SayHelloCommand>))]`.
- `SayHelloPermissionMapper` maps only the **Admin** role to the `SAY_HELLO`
  permission — the Manager and Invalid roles from Scenario 1 do not grant it.
- `SayDataScopeValidator` checks `dataScope.CompanyId.AllowedFor(message.CompanyId)` —
  the Admin role's `dataScope.CompanyId` is `"C1"` (not a wildcard), so your request
  body's `companyId` must be exactly `"C1"` to pass.

```bash
curl -X POST https://localhost:<servicea-port>/api/hello \
  -H "Authorization: Bearer <token-from-scenario-1>" \
  -H "Content-Type: application/json" \
  -d '{"foo":"hello world","companyId":"C1"}'
```

A `companyId` other than `"C1"` gets a permission-denied failure — per
`docs/reference/packages/NEvo.Messaging.Authorization.md` § "What happens when
validation fails", that currently surfaces as a generic HTTP `500`, not `403`.

**On success, the handler also publishes an event, fanned out to two independent
handlers.** `SayHelloCommandHandler` doesn't just return success — it publishes
`MyEvent(message.Foo)` via `IEventPublisher` (`SayHelloCommandHandler.cs:14`). Two
handlers are registered for `MyEvent`
(`MessageHandlerRegistryExtensions.cs:13-14`): `MyEventHandlerA` and `MyEventHandlerB`,
each independently implementing `IEventHandler<MyEvent>` and printing `HandlerA:
<foo>` / `HandlerB: <foo>` to the console; `MyEventHandlerB` additionally throws if
`foo` is literally the string `"Exception"` (`MyEventHandlerB.cs:11-12` — a simple way
to exercise the failure path of one handler in the fan-out without affecting the
other). Watch the console for both `HandlerA:`/`HandlerB:` lines after a successful
`/api/hello` call — this is the exact "command handler publishes an event, independent
handlers react" shape walked through from scratch, on a smaller illustrative example,
in [Quick start § 6. Publish an event, and react to it
independently](quick-start.md#6-publish-an-event-and-react-to-it-independently).

## Scenario 3: the Document event-sourcing flow

`POST /api/document/create` (`Routes.cs`) maps to `CreateDocument`
(`ExampleDomain/Documents/DocumentCommands.cs`), handled through
`docs/reference/packages/NEvo.Ddd.EventSourcing.md`'s decider/evolver flow, matching
`docs/development/event-sourcing.md`'s description of this exact aggregate.

**The `Document` aggregate used here is imported directly from
`NEvo.Ddd.EventSourcing.Tests.Mocks`** (`using NEvo.Ddd.EventSourcing.Tests.Mocks;` in
`Program.cs` and `Routes.cs`) — this "example domain" is literally the event-sourcing
package's own test fixture, not domain code written for this example app.

```bash
curl -X POST https://localhost:<servicea-port>/api/document/create \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<a-guid>","data":"hello"}'
```

**This will report success but persist nothing.** `Program.cs` calls
`AddEventSourcing(typeof(Document))` and registers no other `IEventStore` — per
`docs/reference/packages/NEvo.Ddd.EventSourcing.md` § Limitations, the default
`IEventStore` is `FakeEventStore`, whose `AppendEventsAsync` is a no-op that reports
success and whose load methods always return "not found." The command completes
without error; there is no working way to load the document back afterward through
this example as configured. Treat this scenario as "the decide step runs and produces
the expected event," not as a real persistence demo.

## Scenario 4: cross-service dispatch

`ServiceA.Api` registers `AddRestMessageDispatcher` targeting `ServiceB`'s
`/api/messages/` for `ServiceBCommand` (`Program.cs`). `POST /api/world` (or
`/api/world_noAuth`) on `ServiceA` dispatches a `ServiceBCommand`, which — because it's
configured as an externally-routed type — goes out over REST to `ServiceB`'s
`POST /api/messages/dispatch` endpoint instead of being handled locally.
`ServiceBCommandHandler` on the receiving side just writes `message.Foo` to the
console.

```bash
curl -X POST https://localhost:<servicea-port>/api/world_noAuth \
  -H "Content-Type: application/json" \
  -d '{"foo":"hello from A"}'
```

Watch `ServiceB`'s console output for the printed value, not `ServiceA`'s — that's how
you confirm the dispatch actually crossed the service boundary. Note also that
`ServiceB`'s `/api/messages/dispatch` endpoint (the receiving side) has no
`.RequireAuthorization()` call — unlike `ServiceA`'s equivalent — so this internal
dispatch path is unauthenticated in this example (see
`docs/project/known-issues.md` § "Example app: ServiceB's internal dispatch endpoint
is unauthenticated").

## Troubleshooting

- **"Unsupported grant type" from `/connect/token`:** you're not using
  `grant_type=password` — see Scenario 1, only that grant is implemented.
- **`/api/hello` always fails with a generic error, even with a valid token:** check
  your request body's `companyId` is exactly `"C1"` — see Scenario 2.
- **Document creation "succeeds" but you can't find any trace of it:** expected — see
  Scenario 3, nothing is actually persisted by default.
- **SQL Server connection details, whether Identity needs additional seed data beyond
  self-registration, and exact Aspire dashboard access:** depend on your local
  Aspire/Docker environment, not something this guide can state generically — see
  "Running the full set" above.

## Next steps

- `docs/reference/packages/classification.md` — the packages this example combines.
- `docs/reference/packages/NEvo.Messaging.Authorization.md`,
  `docs/reference/packages/NEvo.Ddd.EventSourcing.md` — the two packages with the most
  notable gaps surfaced in this walkthrough.
