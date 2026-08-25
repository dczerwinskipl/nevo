---
id: development.node-tooling-guidelines
type: development
title: Node tooling guidelines
status: current
read_when:
  - creating or restructuring Node CLI commands
  - changing Node-based developer tooling
  - changing dashboard server code
  - running Git, filesystem, or child-process operations from Node
  - adding long-running operations, progress, streaming, or cancellation
  - refactoring Node modules under tools
  - Node tooling or server changes
summary: >
  Practical architecture guidelines for Node-based developer tooling, CLI commands, and
  long-lived dashboard server code. Covers module boundaries, thin external boundaries,
  pure decision logic vs IO, async process execution, lifecycle and cancellation, dependency
  injection, error mapping, testing boundaries, and anti-overengineering rules.
related:
  - development.coding-conventions
  - development.architecture-overview
  - development.react-component-guidelines
---

# Node Tooling Guidelines

## Purpose and Repository Context

This document defines the preferred architecture for Node-based developer tooling and dashboard server code.

**Repository context:** The NEvo repository is primarily a .NET project. Node tooling, the developer dashboard, and the AI orchestration layer currently reside in this repository because it is easier to develop, test, and verify end-to-end integration here. Eventually, most of this developer tooling will be extracted into a dedicated tooling repository.

Therefore, these guidelines are:
- practical for the current `tools/` codebase;
- portable to a future standalone tooling repository;
- strictly scoped to Node tooling and server processes;
- designed to avoid imposing enterprise .NET layering or turning the NEvo repository into a JavaScript-centric architecture.

The goal is to keep command boundaries thin, application behavior reusable across CLI and dashboard HTTP routes, external effects explicit, long-running processes responsive and cancellable, and modules easy to test.

---

# How to apply this guideline

Before planning or executing any Node tooling refactoring, apply these rules:

1. **Responsibilities, not mandatory directory trees:** This document defines architectural responsibilities, not an obligatory target directory layout. Example module names and directory paths in this guide are illustrative.
2. **Do not create ceremonial layers:** Do not introduce artificial `Handler`, `Service`, `Manager`, `Repository`, or `Adapter` layers when each layer merely forwards arguments without owning a distinct responsibility.
3. **Do not refactor solely based on file size:** Never create a refactoring task or split a file solely because it has many lines of code. A large, cohesive module representing a single deterministic capability should remain as-is.
4. **Do not force test reorganizations mechanically:** Do not reorganize existing test suites merely to mirror production directory layouts. Move or add tests only when an actual shift in responsibility or ownership makes the existing test structure nonsensical.
5. **Smallest boundary solving a real problem:** Prefer the smallest, simplest structural boundary that solves a concrete problem in testability, reuse, or process lifecycle.

---

# 1. Core architecture

Prefer this conceptual flow of responsibilities:

```text
external boundary
CLI / HTTP / event
        ↓
application use case / orchestration
        ↓
pure policy / transformation / state logic
        ↓
explicit external dependencies
filesystem / git / process / provider / network
```

These are responsibilities, not mandatory directories, classes, or ceremonial patterns.

Do not force commands to pass through forwarding chains:

```text
Command → Handler → Service → Manager → Repository
```

Introduce a boundary only when it owns a meaningful, observable responsibility.

---

# 2. External boundaries should be thin

## 2.1 CLI entrypoints

A CLI entrypoint should primarily:
- define commands and options;
- parse command-line arguments;
- validate boundary input shape;
- map parsed input to an application operation;
- render human-readable or machine-readable output (`stdout` vs `stderr`);
- map final failures to the CLI error and exit code contract.

It should not contain large amounts of workflow orchestration or domain logic. Large command-registration files are a smell when they also embed full implementations of every operation.

## 2.2 HTTP / Dashboard handlers

An HTTP handler should primarily:
- parse and validate request parameters and bodies;
- enforce request-level preconditions;
- call an application or runtime operation;
- map the result to the HTTP status or SSE event stream contract.

Do not place Git workflows, filesystem algorithms, provider lifecycle, or child process management directly inside route handlers.

## 2.3 Reuse application operations directly

When the CLI and dashboard need the same semantic operation, use a shared application function:

```text
CLI --------\
             → finalizeSpecification(...)
HTTP -------/
```

Do not spawn the project's own CLI as a subprocess merely to reuse internal application behavior from HTTP handlers.

A subprocess is appropriate when invoking an external executable (e.g. `git`, `gh`) or when true OS-level process isolation is required.

---

# 3. Organize modules by cohesive capability

Prefer modules named around what the code actually does:

```text
workflow/finalize.mjs
workflow/verification.mjs
spec/context.mjs
spec/changes.mjs
git/client.mjs
process/runner.mjs
```

Avoid dumping unrelated behaviors into generic catch-all nouns:

```text
service.mjs
manager.mjs
utils.mjs
helpers.mjs
```

A `service.mjs` or `helpers.mjs` file becomes an architectural smell when it turns into the default dumping ground for unrelated capabilities. Split by cohesive capability and change boundary, not by architectural vocabulary.

Conversely, do not create "one file per function" without a real ownership benefit.

---

# 4. File size is an inspection trigger, not an extraction reason

Do not enforce hard or soft maximum LOC limits.

**File size may trigger inspection, but it must not be the architectural reason for extraction.**

A large file should prompt inspection, but refactoring is justified only when a concrete architectural problem is present:
- multiple independent capabilities mixed in one module;
- external I/O mixed with complex deterministic decision logic;
- multiple lifecycle owners or unmanaged background resources;
- coupling CLI formatting and exit codes with deep reusable operations;
- difficulty understanding or unit-testing the module due to unrelated side effects.

A large deterministic parser, schema definition, or state machine can be completely valid and easier to maintain in one cohesive module. Conversely, a small module with unrelated side effects and mixed boundaries may need refactoring despite low line count.

---

# 5. Pure logic and external I/O

Keep deterministic decision logic separate from external effects where practical:

```js
const decision = evaluateFinalizeState(spec, checks);
await git.push(decision.branch);
```

Pure logic is valuable because it is:
- fast and deterministic to test without mocking;
- easy to reason about;
- directly reusable across CLI, HTTP, and background workers.

Do not create interfaces or adapter layers for every trivial filesystem call when there is no testing or ownership benefit. The goal is explicit effect boundaries, not abstraction for its own sake.

---

# 6. External adapters (Git, Filesystem, Providers)

External systems should have narrow, application-facing APIs:

```js
git.status();
git.diff(base, head);
git.commit(message);

files.readJson(path);
files.writeJson(path, value);

provider.startTurn(input);
provider.cancelTurn(id);
```

Avoid exposing raw command strings or low-level process details throughout application code. Normalize external output near the adapter boundary when doing so simplifies caller logic, while preserving useful diagnostics for failures.

---

# 7. Dependency injection without a container

Use explicit, lightweight dependency injection via function arguments or factory functions:

```js
export function createFinalizeSpec({ git, files, clock }) {
  return async function finalizeSpec(input) {
    // ...
  };
}
```

or:

```js
export async function finalizeSpec(input, { git, files }) {
  // ...
}
```

Do not introduce a DI container for ordinary developer tooling. Inject dependencies that represent:
- external effects (Git, filesystem, child processes, network);
- nondeterministic sources (system clock, UUID generation);
- provider implementations;
- runtime resources requiring lifecycle management.

Do not inject pure helper functions.

---

# 8. Async policy: Short-lived CLI vs Long-lived Server

## 8.1 Short-lived CLI commands

Synchronous operations (`readFileSync`, bounded synchronous checks) are acceptable in short-lived CLI commands when:
- the operation is small and bounded;
- blocking only delays that single command invocation;
- no progress streaming, concurrency, or cancellation is required;
- the synchronous implementation is materially simpler to read and maintain.

Do not convert small, bounded CLI operations to async solely because async APIs exist.

## 8.2 Long-lived dashboard / server runtime

Potentially long-running operations on request, SSE, polling, or event paths **must never block the Node event loop**.

In long-lived server code:
- use asynchronous child-process APIs (`execFile`, `spawn`);
- use asynchronous I/O for potentially slow operations;
- keep HTTP and SSE handling responsive while operations run;
- stream progress and output where useful;
- propagate cancellation (`AbortSignal`);
- clean up child processes, timers, listeners, and subscriptions upon completion or client disconnect.

`execFileSync`, `spawnSync`, or long synchronous Git/filesystem operations are strictly forbidden on server request paths for potentially slow work.

---

# 9. Child process execution

Choose the process execution API based on behavior:

## 9.1 `execFile` (asynchronous)

Prefer asynchronous `execFile` when:
- invoking a known executable directly;
- output is bounded and can be safely buffered in memory;
- shell syntax is not required.

## 9.2 `spawn` (asynchronous)

Prefer `spawn` when:
- the process may run for an extended duration;
- stdout/stderr should be streamed to clients or logs;
- progress needs to be observed incrementally;
- cancellation (`AbortSignal`) or lifecycle termination is required;
- output may be large.

## 9.3 Shell execution

Avoid shell execution (`exec`, shell options) by default. Use shell syntax only when the operation genuinely requires shell features (e.g. pipelines, variable expansion). Prefer executable + argument arrays (`['commit', '-m', message]`) over command-string concatenation to prevent quoting bugs and command injection.

## 9.4 Process lifecycle and cancellation

For owned long-running child processes:
- handle startup errors and detach listeners properly;
- prevent double-completion bugs between `error` and `close` events;
- preserve exit code and signal diagnostics;
- terminate child processes during cancellation or server shutdown;
- accept an `AbortSignal` for cooperative cancellation.

---

# 10. Runtime mutable state

Avoid ambient or global mutable state.

**Mutable runtime state must have an identifiable owner, lifecycle, and mutation API.**

Good patterns include:
- an `OperationRuntime` instance owning active background operations;
- a provider session registry owned by the server bootstrap;
- an injected cache instance with an explicit lifetime.

Avoid unrelated modules directly mutating shared exported objects or maps.

---

# 11. Errors and boundary mapping

Deep application logic must not:
- write directly to `console.log` / `console.error`;
- call `process.exit()`;
- set `process.exitCode`;
- construct HTTP response objects.

Application modules should return results or throw structured errors. External boundaries map those outcomes:

```text
Application Error → CLI Boundary    → stderr message + process.exitCode = 1
Application Error → HTTP Boundary   → 4xx/5xx JSON response
Application Error → SSE Boundary    → 'error' event + stream close
```

Use structured error codes (`code: "SPEC_NOT_FOUND"`) when callers need to distinguish failure categories programmatically.

---

# 12. CLI output as an external tool contract

Treat CLI output as an external contract, especially when automated AI agents execute CLI commands:
- **`stdout`**: primary command results (clean human summary or stable machine-readable JSON/YAML);
- **`stderr`**: warnings, progress logs, diagnostics, and error details;
- **Exit code `0`**: successful execution;
- **Non-zero exit code**: execution failure;
- Keep machine-readable stdout clean and free from diagnostic chatter.

Prefer setting `process.exitCode = 1` over abruptly calling `process.exit()` to allow pending stream writes and asynchronous cleanup to flush cleanly.

---

# 13. Testing strategy

Test behavior at the responsibility level that owns it:

1. **Pure logic:** Focused unit tests for validation rules, state transitions, path calculations, fingerprinting, and normalization.
2. **Application operations:** Unit and integration tests with controlled fakes/stubs for external dependencies (Git, filesystem, clock).
3. **Adapters:** Integration tests against realistic boundaries (e.g. Git wrapper against a temporary repo, process runner, schema compatibility).
4. **CLI boundary:** Tests for argument parsing, validation failures, stdout/stderr formatting, and exit code mapping.
5. **Server runtime:** Tests for request validation, SSE event streaming, cancellation, and graceful shutdown.

**Do not require reorganizing the entire test suite just to match production file structure.** Move or split tests only when a new responsibility or module makes the existing location or ownership nonsensical.

---

# 14. Review checklist

When creating or refactoring Node tooling code, verify:

- [ ] Is the external boundary (CLI / HTTP) thin?
- [ ] Can application operations be reused without spawning CLI subprocesses?
- [ ] Are modules grouped by cohesive capability rather than catch-all nouns (`service.mjs`, `utils.mjs`)?
- [ ] Is file size used solely as an inspection trigger rather than an extraction rule?
- [ ] Is deterministic decision logic separated from external I/O effects where useful?
- [ ] Is dependency injection explicit and lightweight rather than container-driven?
- [ ] Does long-lived server code avoid blocking the event loop with synchronous calls?
- [ ] Are child processes spawned with appropriate streaming, timeout, and cancellation (`AbortSignal`) handling?
- [ ] Does mutable runtime state have an identifiable owner and lifecycle?
- [ ] Do deep application modules avoid direct console writes, exit codes, and HTTP concerns?
- [ ] Are stdout, stderr, and exit codes treated as stable contracts for agent automation?
- [ ] Are tests focused at the responsibility level they verify without forced structural mirror reorganizations?
