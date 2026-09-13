---
id: ai-adapters-hardening.windows-process-tree-termination
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/06-operation-process-lifecycle.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/process-termination.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/process-termination.mjs
  - tools/dashboard/tests/process-termination.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D9]
  constraints: [C9]
---

# Task: Implement OS-aware process tree termination and spawn configuration for child processes

## Goal

Harden `tools/dashboard/server/ai/providers/process-termination.mjs` to establish process-group ownership at spawn time and terminate entire child process trees on Windows (via `taskkill.exe /PID <pid> /T /F` or Job Objects) and POSIX (via process groups `process.kill(-pid, signal)`), eliminating orphaned grandchild subprocesses during CLI turn cancellation or timeout.

## Requirements

- Expose a shared spawn helper or options provider (e.g. `getProcessTreeSpawnOptions()`) in `process-termination.mjs` returning `{ detached: process.platform !== 'win32' }`, enabling POSIX process-group leadership without unwanted Windows console windows.
- Update `terminateChildProcess(child, { graceMs, forceGraceMs })` to detect the host operating system.
- On Windows:
  - Attempt initial graceful cancellation (e.g. `child.kill('SIGINT')` or equivalent handle signal).
  - If forceful kill is required or escalation occurs, invoke `taskkill.exe /PID <pid> /T /F` to terminate the root process and all child/grandchild worker processes spawned by tools or build steps.
- On POSIX:
  - For processes spawned with process-group leadership (`detached: true`), target the process group via `process.kill(-pid, signal)` on forceful escalation.
- Implement post-termination verification checking that the target PID has ceased executing before resolving the termination promise.
- Handle edge cases cleanly: process already exited, access denied errors, invalid PIDs, and missing system binaries.
- Epistemic boundary: Document that process tree termination proves only that OS process liveness has ended; it does not determine or assert semantic provider result.
- Automated tests in `tools/dashboard/tests/process-termination.test.mjs` must not rely solely on mock EventEmitter wrappers. Include a real integration test that spawns a parent process that itself spawns a long-running descendant process, terminates the tree via `terminateChildProcess()`, and confirms via OS liveness checks (`process.kill(pid, 0)`) that both parent and descendant PIDs are dead.

## Acceptance criteria

1. Process helper exports shared spawn configuration (`detached: true` on POSIX, `false`/omitted on Windows) to establish proper process-group ownership. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
2. Process termination helper detects Windows and invokes `taskkill.exe /PID <pid> /T /F` upon forceful termination escalation. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
3. Process termination helper on POSIX targets process groups via `process.kill(-pid, signal)` without leaving dangling detached workers. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
4. Graceful termination timeout fires and escalates to forceful termination when the root process fails to exit within `graceMs`. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
5. If a target process has already exited prior to termination invocation, the function resolves cleanly without throwing uncaught errors. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
6. Process exit verification confirms PID termination before resolving the promise. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`
7. Real process-tree integration test spawns a parent process that launches a long-running descendant process, terminates the tree via `terminateChildProcess()`, and confirms via OS liveness checks (`process.kill(pid, 0)`) that both parent and descendant PIDs are dead. `automated: node --test tools/dashboard/tests/process-termination.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/process-termination.test.mjs
```
