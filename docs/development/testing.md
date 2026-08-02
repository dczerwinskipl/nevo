---
id: development.testing
type: development
title: Testing
status: current
read_when:
  - writing tests
  - choosing a test approach
  - adding a test project
summary: >
  Test stack, project structure, coverage expectations, and conventions.
  Integration tests for the messaging pipeline do not yet exist — this is a known gap.
related:
  - development.local-setup
---

# Testing

## Stack

| Tool | Role |
|---|---|
| xUnit | Test framework |
| FluentAssertions | Assertions |
| FluentAssertions.LanguageExt | LanguageExt Either/Option assertions |
| Moq | Mocking |
| coverlet | Code coverage collection |

## Test projects

```
tests/
  NEvo.Core.Tests              Middleware ordering, guard clauses, functional extensions
  NEvo.Messaging.Tests         Message processing pipeline mechanics
  NEvo.Ddd.EventSourcing.Tests Aggregate reconstruction, event folding
  NEvo.Orchestrating.Tests     Step execution, compensation on failure
  NEvo.Web.Authorization.Tests Claims-based auth middleware
```

## Known coverage gap

There are **no automated integration tests** for the full message dispatch pipeline:
- End-to-end with real handlers
- Inbox idempotency behavior
- Outbox publishing
- HTTP transport (`RestExternalMessageDispatchStrategy`)
- Context propagation across middleware

Current behavior is verified through the example applications (`examples/ExampleApp/`)
which are run manually. Adding integration tests for the messaging pipeline is the next
priority after architecture documentation.

## Conventions

- Test class names: `<SubjectClass>Tests`
- Test method names: describe the behavior, not the implementation — e.g.,
  `ExecutesMiddlewaresInCorrectOrder`, not `Test_Run_Order`
- Arrange/Act/Assert structure (no explicit comments needed)
- Use `FluentAssertions` for all assertions
- Use `Either<Exception, T>` assertion extensions from `FluentAssertions.LanguageExt`
  when testing pipeline results

## Characterization tests

Before modifying any subsystem, add characterization tests that capture current behavior.
This is especially important for the messaging pipeline, inbox/outbox, and persistence layer.
Do not change behavior and write tests simultaneously.

## Tooling tests (`tools/`)

`tools/specs.mjs` and `tools/docs.mjs` (and `.claude/hooks/*.mjs`) are plain Node
scripts, not part of the xUnit stack above — they have their own, separate tests using
Node's built-in `node:test` runner. No new dependency: Node 18+ ships it.

```bash
node --test tools/tests/*.test.mjs
```

Structure: `tools/tests/*.test.mjs`. Prefer testing exported pure functions
(`parseYaml`, `validateTransition`, `validateApproval`, `computeSpecFingerprint`,
the Bash guard's `validateCommand`, ...) directly over spawning a process for every
case — reserve spawned-process tests (`node:child_process`) for a small set of
CLI-level smoke tests covering the important success/failure paths. Both `tools/
specs.mjs` and `tools/docs.mjs` guard their CLI dispatch behind an
"is this the directly-executed module" check specifically so their internals can be
imported by tests without triggering `process.exit()`.
