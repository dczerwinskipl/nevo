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
  - refactoring large .mjs modules under tools
summary: >
  Practical architecture guidelines for Node-based tooling, CLI commands, and
  long-lived dashboard/server code. Covers module boundaries, command/application
  separation, external IO, async process execution, errors and exit codes,
  dependency injection, testing, runtime state, and pragmatic module sizing.
related:
  - development.coding-conventions
  - development.architecture-overview
---

# Node Tooling Guidelines

## Purpose

This document defines the preferred architecture for Node-based developer tooling.

It applies to both:

- short-lived CLI commands;
- long-lived dashboard/server processes.

These runtimes have different constraints. A synchronous operation that is acceptable during a short CLI startup may be unacceptable on an HTTP/SSE request path.

The goal is not to reproduce enterprise .NET layering in JavaScript. The goal is to keep command boundaries thin, application behavior reusable, external effects explicit, long-running processes responsive, and modules easy to test.

---

# 1. Core architecture

Prefer this conceptual flow:

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

These are responsibilities, not mandatory directories or classes.

Do not require every command to pass through ceremonial layers such as:

```text
Command
→ Handler
→ Service
→ Manager
→ Repository
```

when each layer only forwards arguments.

Introduce a boundary when it owns a meaningful responsibility.

---

# 2. External boundaries should be thin

## 2.1 CLI entrypoints

A CLI entrypoint should primarily:

- define commands and options;
- parse arguments;
- validate command-line shape;
- map parsed input to an application operation;
- render human-readable or machine-readable output;
- map final failures to the CLI error/exit contract.

It should not contain large amounts of workflow/business logic.

Large command-registration files are a smell when they also contain implementation of every operation.

## 2.2 HTTP/dashboard handlers

An HTTP handler should primarily:

- parse and validate request input;
- enforce request-level preconditions;
- call an application/runtime operation;
- map the result to the HTTP/SSE contract.

Do not place Git workflows, filesystem algorithms, provider lifecycle, or process-management logic directly in route handlers.

## 2.3 Reuse application code directly

When CLI and dashboard need the same operation, prefer a shared application API.

Prefer:

```text
CLI --------\
             → finalizeSpecification(...)
HTTP -------/
```

over:

```text
HTTP → spawn own CLI → parse own CLI output
```

Do not use a subprocess as an internal module boundary merely because a CLI already exists.

A subprocess is appropriate when process isolation itself is required or when invoking an external tool.

---

# 3. Organize modules by cohesive capability

Prefer modules named around what the code does:

```text
workflow/finalize.mjs
workflow/verification.mjs
spec/context.mjs
spec/changes.mjs
runtime/operations.mjs
git/client.mjs
process/runner.mjs
```

over dumping unrelated behavior into broad nouns such as:

```text
service.mjs
manager.mjs
utils.mjs
helpers.mjs
```

A `service.mjs` file is not automatically wrong. It becomes a smell when it turns into the default destination for unrelated operations.

Split by cohesive responsibility and change boundary, not by architectural vocabulary.

---

# 4. File and module sizing

Do not enforce hard LOC limits.

Use size as a review trigger.

Practical signals:

- around **200–300 LOC**: inspect whether a module still represents one cohesive capability;
- around **500 LOC**: strong smell, especially if the module mixes parsing, orchestration, IO, state, and formatting;
- around **1000 LOC**: normally indicates that multiple capabilities have accumulated and should be reviewed explicitly.

These are not automatic violations.

A large deterministic parser, schema definition, or cohesive state machine may be easier to maintain as one module than as many artificial files.

A 120-line module with several unrelated side effects may need refactoring sooner than a 500-line cohesive pure module.

Responsibility takes precedence over LOC.

---

# 5. When to extract a function or module

Extract when it creates a useful boundary, for example:

- a function performs a coherent operation that can be named clearly;
- logic is independently testable;
- external IO can be separated from decision logic;
- lifecycle or cleanup behavior deserves ownership;
- several callers need the same semantic operation;
- a large command becomes easier to understand as orchestration;
- the code changes for a different reason than its surrounding module.

Do not extract merely because a function exceeded an arbitrary number of lines.

Do not create one-file-per-function modules without a real ownership benefit.

---

# 6. Pure logic and external IO

Keep deterministic decision logic separate from external effects where practical.

Prefer:

```js
const decision = evaluateFinalizeState(spec, checks);
await git.push(decision.branch);
```

over embedding filesystem/Git/process calls throughout the decision logic.

Pure logic is valuable because it is:

- fast to test;
- deterministic;
- easier to reason about;
- reusable across CLI and dashboard entrypoints.

Do not turn every filesystem call into an interface if there is no testing or ownership benefit.

The goal is explicit effect boundaries, not abstraction for its own sake.

---

# 7. Filesystem, Git, network, and provider adapters

External systems should have narrow application-facing APIs.

Examples:

```js
git.status();
git.diff(base, head);
git.commit(message);
git.push(remote, branch);

files.readJson(path);
files.writeJson(path, value);

provider.startTurn(input);
provider.cancelTurn(id);
```

Avoid exposing raw command strings or low-level process details throughout application code.

Normalize external output near the adapter boundary when doing so simplifies the rest of the code.

Preserve useful diagnostics for failures.

---

# 8. Dependency injection without a container

Use explicit dependencies when they improve testability or ownership.

Good options include:

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

Do not introduce a DI container for ordinary local tooling unless the project develops a concrete need for one.

Inject dependencies that are:

- external effects;
- nondeterministic sources such as clock/ID generation;
- provider implementations;
- runtime resources requiring lifecycle management.

Do not inject every pure helper function.

---

# 9. Async policy: CLI and server are different

## 9.1 Short-lived CLI

Synchronous filesystem operations can be acceptable in a short-lived CLI when:

- the operation is small and bounded;
- blocking only delays that one command;
- no streaming, progress, concurrency, or cancellation is required;
- the simpler implementation is materially easier to understand.

Do not convert small bounded CLI operations to async solely because async APIs exist.

Potentially long-running external processes should still normally use asynchronous process APIs when progress, cancellation, or large output matters.

## 9.2 Long-lived dashboard/server runtime

Do not block the Node event loop with potentially long-running synchronous work on request, SSE, websocket, polling, or event-processing paths.

In long-lived runtime code:

- use asynchronous child-process APIs;
- use asynchronous IO for potentially slow operations;
- keep HTTP/SSE handling responsive while operations run;
- stream progress/output where useful;
- propagate cancellation when the operation can outlive its requester;
- clean up processes, timers, listeners, and subscriptions.

`execFileSync`, `spawnSync`, or long synchronous Git/file operations are not appropriate on a server request path unless the operation is demonstrably tiny and bounded.

Treat this as a runtime architecture rule, not a style preference.

---

# 10. Child process execution

Choose the process API by behavior.

## 10.1 `execFile`

Prefer asynchronous `execFile` when:

- invoking a known executable directly;
- output is bounded and can be buffered;
- shell syntax is not needed.

## 10.2 `spawn`

Prefer `spawn` when:

- the process may run for a long time;
- stdout/stderr should be streamed;
- progress needs to be surfaced;
- cancellation or lifecycle control matters;
- output may be too large to buffer safely.

## 10.3 Shell execution

Avoid shell execution by default.

Use shell syntax only when the operation genuinely requires shell features.

Prefer executable + argument arrays to command-string construction.

This reduces quoting problems and command-injection risk.

## 10.4 Process lifecycle

For owned long-running child processes:

- handle startup errors;
- handle exit/close deliberately;
- avoid double-completing an operation when both error and exit events occur;
- preserve exit code and signal information;
- clean up listeners;
- terminate child processes during cancellation/shutdown when ownership requires it;
- decide what happens to child processes if the parent request disconnects.

Prefer `AbortSignal` or an equivalent explicit cancellation contract where supported by the chosen API.

---

# 11. Runtime state

Avoid ambient/global mutable state.

Necessary mutable runtime state should have a clear owner and lifecycle.

Good examples:

- an `OperationRuntime` instance owning active operations;
- a provider-session registry owned by the server runtime;
- an injected cache with explicit lifetime.

The rule is not "no mutable state."

The rule is:

> mutable state must have an identifiable owner, lifecycle, and mutation API.

Avoid unrelated modules mutating shared exported maps/objects directly.

---

# 12. Cancellation and shutdown

Long-running tooling should define ownership of cancellation.

When relevant:

- accept an `AbortSignal` or equivalent;
- propagate cancellation through application and adapter layers;
- terminate owned child processes;
- unsubscribe listeners;
- clear timers;
- stop polling;
- mark operation state consistently.

Server shutdown should clean up resources it owns.

Do not rely on `process.on("exit")` for asynchronous cleanup. Exit handlers cannot complete asynchronous work after the process is already exiting.

---

# 13. Input parsing and validation

Validate input at the boundary where untrusted or loosely typed data enters.

Examples:

- CLI arguments;
- environment variables;
- JSON/YAML configuration;
- HTTP request bodies/params;
- provider payloads;
- persisted local state when schema can evolve.

Separate:

```text
parse
→ validate
→ normalize
→ execute
```

when the distinction makes failures clearer.

Do not repeatedly revalidate the same internal trusted object at every layer.

Prefer one normalized application input shape after boundary validation.

---

# 14. Errors

Errors should preserve meaning across layers.

Application/deeper modules should not normally:

- print directly to console;
- call `process.exit()`;
- set `process.exitCode`;
- construct HTTP responses.

They should return a result or throw/reject with enough structured information for the external boundary to map appropriately.

Use structured error types/codes when callers need to distinguish failure categories.

Do not build a large inheritance hierarchy of custom errors unless the number of distinct contracts justifies it.

Useful fields may include:

```js
{
  code: "SPEC_NOT_READY",
  message: "...",
  details: {...},
  cause: error
}
```

Use one stable machine-oriented error code when automation depends on the distinction.

---

# 15. CLI stdout, stderr, and exit codes

Treat CLI output as an external contract, especially when agents call the CLI as a tool.

Prefer:

- normal result/output on `stdout`;
- warnings and diagnostics on `stderr`;
- exit code `0` for successful command completion;
- non-zero exit codes for command failure;
- stable machine-readable output mode where automation needs to parse results.

Avoid mixing progress chatter into machine-readable stdout.

Do not let deep application functions decide process exit behavior.

The CLI boundary should map application outcomes to exit codes.

Prefer graceful completion with `process.exitCode` over unnecessary direct `process.exit()` calls when pending stdout/stderr writes or cleanup should complete.

---

# 16. Logging and observability

Distinguish:

- user-facing CLI output;
- structured server logs;
- operation progress;
- diagnostic/debug detail.

Do not scatter `console.log` through deep reusable modules.

For long-running operations, emit progress through an explicit operation/progress abstraction rather than coupling application code directly to SSE or HTTP.

Preserve useful child-process stderr and exit metadata in failure diagnostics.

Do not log secrets, tokens, or sensitive environment/config values.

---

# 17. Long-running operation model

Operations that may take noticeable time should have explicit lifecycle semantics.

A useful model may include:

```text
queued
running
completed
failed
cancelled
```

Only introduce states the product actually needs.

The runtime owning an operation should define:

- operation ID;
- start/end lifecycle;
- progress/events;
- terminal result/error;
- cancellation behavior;
- cleanup;
- retention/removal policy if applicable.

Do not use an operation framework for every trivial synchronous command.

Use it for work that needs observation, progress, cancellation, or independent lifetime.

---

# 18. Avoid duplicate execution paths

Do not maintain separate implementations for:

- CLI execution;
- dashboard execution;
- tests.

Prefer the same application operation with different adapters/boundaries.

Tests may provide fake adapters.

CLI and HTTP should translate their own input/output contracts around the shared operation.

---

# 19. Testing strategy

Test behavior at the responsibility that owns it.

## 19.1 Pure logic

Use focused unit tests for:

- validation rules;
- state transitions;
- workflow decisions;
- path calculations;
- normalization;
- deterministic transformations.

## 19.2 Application/use-case modules

Test with controlled dependencies:

- expected Git/filesystem/provider calls;
- failure propagation;
- cancellation;
- orchestration order where behavior depends on it;
- mapping of external results into application results.

Use simple fakes/stubs rather than a heavy mocking framework unless the project already standardizes one.

## 19.3 Adapters

Use integration-style tests where the value lies in the external boundary:

- process runner;
- Git wrapper;
- filesystem persistence;
- provider protocol parsing.

Avoid mocking a wrapper so completely that its real contract is never exercised anywhere.

## 19.4 CLI boundary

Test:

- argument parsing for important commands;
- validation failures;
- stdout/stderr contract where automation relies on it;
- exit-code mapping.

Do not test every Commander/library implementation detail.

## 19.5 Server/runtime

Test:

- request validation;
- operation lifecycle;
- progress/subscription behavior;
- cancellation;
- cleanup;
- concurrent operation isolation where relevant.

---

# 20. Global state, environment, and configuration

Read environment/configuration at an explicit composition boundary where practical.

Avoid deep modules reading arbitrary `process.env` values throughout the codebase.

Normalize configuration once and pass the required values to the code that owns them.

Do not expose mutable configuration as a globally shared object unless there is a concrete reason.

---

# 21. ESM and imports

Follow the repository's established ESM conventions.

Prefer explicit imports from owning modules.

Avoid circular dependencies between application modules.

If two modules depend on each other, inspect whether:

- responsibilities are mixed;
- a lower-level shared concept is missing;
- orchestration belongs in a third module.

Avoid barrel files when they hide dependency direction or create circular imports.

Use them only when they provide a stable intentional public surface.

---

# 22. Comments and naming

Prefer names that describe behavior or capability.

Good:

```text
finalizeSpec
loadWorkflowDefinition
projectOperationState
runGitCommand
```

Less useful:

```text
handleThing
processData
manager
helper
utils
```

Comments should explain non-obvious constraints, protocol behavior, or architectural reasons.

Do not narrate straightforward code.

---

# 23. Refactoring rule

When touching a large or mixed-responsibility Node module:

- improve the boundaries required by the touched behavior;
- move CLI/HTTP concerns toward the external boundary;
- extract coherent application operations;
- isolate external IO where it improves reuse or testing;
- replace blocking server-path operations when the touched behavior depends on them;
- preserve command/output/runtime contracts unless the task explicitly changes them;
- remove dead paths superseded by the refactor.

Do not redesign the entire tooling architecture as collateral cleanup.

Do not mechanically split a large file into many files that retain the same coupling.

A successful refactor should reduce responsibility mixing, not merely reduce LOC per file.

---

# 24. Anti-patterns to watch for

Review carefully when you see:

- a CLI registration file containing most application logic;
- a route handler executing complex Git/filesystem workflows directly;
- server request code using `execFileSync` or `spawnSync` for potentially long work;
- HTTP code spawning the project's own CLI only to reuse application behavior;
- one large `service.mjs` accumulating unrelated capabilities;
- deep reusable code writing directly to stdout/stderr;
- deep code setting process exit codes;
- exported mutable maps/objects changed by unrelated modules;
- large hooks/functions that merely move a giant-module problem;
- generic `utils` modules containing unrelated helpers;
- abstractions with only one forwarding method and no ownership value;
- separate CLI and dashboard implementations of the same operation.

These are review signals, not automatic failures.

---

# 25. Review checklist

When creating or refactoring Node tooling, verify:

- [ ] Is the external boundary thin?
- [ ] Is application behavior reusable outside CLI/HTTP?
- [ ] Are modules grouped by cohesive capability rather than generic architectural nouns?
- [ ] Is module size being treated as a smell rather than a hard limit?
- [ ] Are deterministic decisions separated from external IO where useful?
- [ ] Are filesystem/Git/process/provider effects behind clear ownership boundaries?
- [ ] Is dependency injection explicit and lightweight rather than container-driven?
- [ ] Does long-lived server code avoid blocking the event loop with potentially long synchronous work?
- [ ] Is the correct child-process API used for buffering vs streaming/lifecycle needs?
- [ ] Is shell execution avoided unless shell features are actually required?
- [ ] Are cancellation and cleanup defined for long-running owned processes?
- [ ] Does mutable runtime state have a clear owner and lifecycle?
- [ ] Is input parsed/validated at the external boundary?
- [ ] Do deep modules avoid console/process/HTTP concerns?
- [ ] Are errors structured enough for callers to map them correctly?
- [ ] Are stdout, stderr, and exit codes stable enough for agent/tool usage?
- [ ] Are long-running operations observable where the product needs progress?
- [ ] Do CLI and dashboard reuse the same application operation rather than duplicate behavior?
- [ ] Are tests focused at the responsibility they verify?
- [ ] Did the refactor improve boundaries rather than merely distribute LOC across more files?
- [ ] Did the change avoid unrelated architectural cleanup?

---

# 26. Practical default

For a small command, prefer the smallest structure that keeps behavior clear:

```text
command registration
      ↓
one application function
      ↓
a few focused helpers/adapters
```

Add more structure only when actual complexity appears.

For long-lived dashboard/server code, be stricter about:

- async behavior;
- process lifecycle;
- cancellation;
- runtime state ownership;
- shared application APIs;
- observability and cleanup.

The architecture should grow with real responsibilities, not with theoretical possibilities.
