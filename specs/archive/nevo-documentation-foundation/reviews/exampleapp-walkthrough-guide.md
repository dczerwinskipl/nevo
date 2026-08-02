---
review-of: task
change: nevo-documentation-foundation
task: exampleapp-walkthrough-guide
generated: 2026-08-02
verdict: pass
implementation_allowed: true
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-documentation-foundation/exampleapp-walkthrough-guide

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — no unresolved blocking findings; all acceptance criteria met and verified.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | INFORMATIONAL | — | — | `Identity.Api`'s `/connect/token` only implements the password grant, despite `AllowClientCredentialsFlow()`/`AllowRefreshTokenFlow()` being enabled in server configuration | Direct read of `Routes.cs`: the handler checks `IsPasswordGrantType()` only, falling through to `UnsupportedGrantType` otherwise | `docs/guides/example-app-walkthrough.md` § Scenario 1 |
| F2 | INFORMATIONAL | — | — | Every issued token carries 3 hardcoded roles regardless of which user authenticated, explicitly marked `// hardcoded for testing` in source | Direct read of `Identity.Api/Routes.cs`, this run | `docs/guides/example-app-walkthrough.md` § Scenario 1 |
| F3 | INFORMATIONAL | — | — | `ServiceA.Api`'s `Document` aggregate (used for the event-sourcing scenario) is imported directly from `NEvo.Ddd.EventSourcing.Tests.Mocks` — the event-sourcing package's own test fixture, not domain code written for this example | `using NEvo.Ddd.EventSourcing.Tests.Mocks;` in both `Program.cs` and `Routes.cs`, this run | `docs/guides/example-app-walkthrough.md` § Scenario 3 |
| F4 | INFORMATIONAL | — | — | `ServiceA.Api` registers `AddEventSourcing(typeof(Document))` with no other `IEventStore` override, so the Document-creation scenario runs against the no-op `FakeEventStore` documented in task 9 — the command succeeds but nothing persists | Cross-referenced against `docs/packages/NEvo.Ddd.EventSourcing.md` (task 9) and re-confirmed directly in `ServiceA.Api/Program.cs`, this run | `docs/guides/example-app-walkthrough.md` § Scenario 3 |
| F5 | INFORMATIONAL | — | — | `ServiceB.Api`'s `/api/messages/dispatch` endpoint (the receiving side of cross-service dispatch) has no `.RequireAuthorization()`, unlike `ServiceA`'s equivalent | Direct read of `ServiceB.Api/Routes.cs` vs. `ServiceA.Api/Routes.cs`, this run | `docs/guides/example-app-walkthrough.md` § Scenario 4 |
| F6 | INFORMATIONAL | — | — | `node tools/docs.mjs validate` — 40 documents, no errors | Command output, this run | — |
| F7 | INFORMATIONAL | — | — | `node tools/specs.mjs validate` — 4 changes, no errors | Command output, this run | — |
| F8 | INFORMATIONAL | — | — | Full tools test suite: 144/144 passing | `node --test tools/tests/*.test.mjs`, this run | — |
| F9 | INFORMATIONAL | — | — | Gating validation: passed. Non-gating repository check: passed — both indexes regenerated as part of this diff | `node tools/docs.mjs check` / `node tools/specs.mjs check`, this run | — |

## Scope compliance

Diff touches: `docs/guides/example-app-walkthrough.md` (new, in `allowed_paths`),
`specs/active/nevo-documentation-foundation/**` (`change.yaml` status transition only),
plus regenerated `docs/index.generated.*` and `specs/index.generated.json`.
`examples/**` (forbidden for edits) was read extensively for verification, never
modified — confirmed by `git status --porcelain`. `src/**`/`tests/**` were not touched.

## Acceptance-criteria coverage

- The guide passes `node tools/docs.mjs validate` under the `guide` type — **met**.
- All 5 `examples/ExampleApp` projects are named at least once, each claim citing the
  specific file inspected — **met**; `grep -c "NEvo.ExampleApp"
  docs/guides/example-app-walkthrough.md` returns 7 (the project-role table plus
  inline mentions), covering `Identity.Api`, `ServiceA.Api`, `ServiceB.Api`,
  `Orchestration.AppHost`, `Orchestration.ServiceDefaults`; every scenario cites the
  specific `.cs` file its claim is grounded in.
- No mention of `examples/Gdpr` — **met**; `grep -i gdpr
  docs/guides/example-app-walkthrough.md` returns no matches.

Additional task-specific constraints, verified directly:
- Covers all 4 required scenarios: running the full Aspire-orchestrated set, the
  `Document`/event-sourcing flow, the cross-service dispatch flow, and a
  permission-checked command flow (`SayHelloCommand`) — plus a dedicated
  "Troubleshooting" section.
- Unverifiable run/setup details (exact Aspire dashboard access, SQL Server connection
  specifics beyond what `AppHost` provisions, whether Identity needs seed data beyond
  self-registration) are stated as open questions, not invented — matching the task's
  explicit instruction and the pre-existing discovery flag noted in the task file.

## Architecture and documentation

No `docs/architecture/**` or `docs/development/**` content changed by this task.
`event-sourcing.md` and `messaging-pipeline.md` were cross-referenced (via the linked
package docs) without being duplicated or found newly stale.

## Tests

No behavior change — documentation-only task. Every scenario's claims (grant-type
handling, hardcoded roles, permission mapping, `FakeEventStore` usage, unauthenticated
dispatch endpoint) were verified against `examples/ExampleApp`'s actual source this
run, not assumed from the task description or prior discovery notes alone.
