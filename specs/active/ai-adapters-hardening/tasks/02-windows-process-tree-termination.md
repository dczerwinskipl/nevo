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
    - tools/dashboard/server/ai/sessions/turns/process-termination.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/turns/process-termination.mjs
  - tools/dashboard/tests/ai-process-termination.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/runtime/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D9]
  constraints: [C9]
---

# Task: Implement OS-aware process tree termination for child processes

## Goal

Harden `terminateChildProcess()` in `process-termination.mjs` to terminate entire child process trees on Windows (via `taskkill.exe /PID <pid> /T /F`) and POSIX (via process groups), eliminating orphaned grandchild subprocesses during CLI turn cancellation or timeout.

## Requirements

- Update `terminateChildProcess(child, { gracefulTimeoutMs, forceTimeoutMs })` to detect the host operating system.
- On Windows:
  - Attempt initial graceful cancellation (e.g. `child.kill('SIGINT')` or equivalent handle signal).
  - If forceful kill is required or escalation occurs, invoke `taskkill.exe /PID <pid> /T /F` to terminate the root process and all child/grandchild worker processes spawned by tools or build steps.
- On POSIX:
  - Ensure processes spawned with `detached: true` are terminated via process group signals (`process.kill(-pid, signal)`).
- Implement a post-termination verification check ensuring that all processes in the tree have ceased executing before resolving the termination promise.
- Handle edge cases cleanly: process already exited, access denied errors, invalid PIDs, and missing system binaries.
- Provide comprehensive automated tests with mock processes verifying tree termination logic and timeouts.

## Acceptance criteria

1. Process termination helper detects Windows and invokes `taskkill.exe /PID <pid> /T /F` upon forceful termination escalation. `automated: node --test tools/dashboard/tests/ai-process-termination.test.mjs`
2. Process termination helper on POSIX targets process groups without leaving dangling detached workers. `automated: node --test tools/dashboard/tests/ai-process-termination.test.mjs`
3. Graceful termination timeout fires and escalates to forceful termination when the root process fails to exit within `gracefulTimeoutMs`. `automated: node --test tools/dashboard/tests/ai-process-termination.test.mjs`
4. If a target process has already exited prior to termination invocation, the function resolves cleanly without throwing uncaught errors. `automated: node --test tools/dashboard/tests/ai-process-termination.test.mjs`
5. Process exit verification confirms termination before resolving the promise. `automated: node --test tools/dashboard/tests/ai-process-termination.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-process-termination.test.mjs
```
