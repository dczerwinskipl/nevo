# Area: Operation and process lifecycle

## Purpose

Define strict lifecycle invariants across provider processes, persistent sessions, Nevo turns, and tool invocations, ensuring predictable process cleanup, robust cancellation, and clean recovery on server restarts.

---

## Four distinct lifecycle domains

Ambiguities in earlier iterations arose from conflating process execution with session identity or turn duration. The hardened architecture explicitly separates four nested lifecycles:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Provider Session Lifetime (Days / Weeks / Months)                     │
│    Correlates to (provider, providerSessionId) across many turns        │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. Provider Process Lifetime (Invocation or Daemon)                      │
│    - Claude / Antigravity: Spans exactly ONE turn (spawn -> exit)       │
│    - Codex: Spans the ENTIRE dashboard AI service lifecycle (daemon)    │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Nevo Turn Lifetime (Seconds to Minutes)                              │
│    Logical unit: User prompt -> Level 2 Work sequence -> FinalAnswer    │
│    Immutable terminal outcome: completed | failed | cancelled | ...     │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. Tool / Activity Lifetime (Milliseconds to Seconds)                   │
│    Individual Level 2 WorkItem + Level 3 ToolAction execution           │
│    Must complete or be sealed before Turn completes                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Lifecycle invariants

### 1. Child process ownership & process trees
- **Direct Child vs Process Tree**: Provider CLI commands (e.g. `claude -p`, `agy`) frequently spawn subprocesses (such as `bash.exe`, `git`, `npm test`, or compilation tools).
- **Process Tree Cleanup Invariant**:
  - `terminateChildProcess()` in `process-termination.mjs` must terminate the **entire process tree**, not merely the root child PID.
  - **On Windows**: Cancellation and forced termination must invoke `taskkill.exe /PID <pid> /T /F` or assign the child to a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Relying solely on `child.kill('SIGINT'/'SIGKILL')` is prohibited because Windows maps this to direct process termination, leaving grand-children running orphaned.
  - **On POSIX**: Processes must be spawned with `detached: true` and terminated via `process.kill(-pid, signal)`.

### 2. Operation handles & non-resumable execution
- An active turn possesses an in-memory `operation` handle held by the provider adapter and registered on `state.privateOperation`.
- **No Detached Polling**: None of the three providers (`claude`, `codex`, `agy`) support detached background operations that can be re-attached or polled after process exit. Turn execution requires an active, uninterrupted communication channel (stdio stream or app-server socket).
- If the communication channel drops or the process dies unexpectedly, the operation is LOST and cannot be resumed in-place. The turn must transition to `status: 'terminal' (outcome: 'failed', cause: 'process_exit')` with `code: 'AI_PROVIDER_EXECUTION_ERROR'`.

### 3. Timeout ownership
- **Nevo Protocol Silence Watchdog**: Owned by `TurnLifecycleCoordinator`. Evaluates inactivity every 10–30s. Silence is suppressed while waiting for user interaction or during evidenced tool activity. Firing transitions turn status to `cancelling` and arbitrates `AI_RUNTIME_TIMEOUT`.
- **Provider Transport Ceilings**: Owned by provider adapters (e.g. Antigravity `--print-timeout`). If fired, the provider reports `AI_PROVIDER_TIMEOUT` with `source: 'antigravity_cli'`.
- **Arbitration Rule**: If a runtime watchdog fires, it sets `timeoutRequested = true` before calling adapter `cancelTurn()`. Even if the adapter or child process crashes during cancellation, the turn settles with `cause: 'timeout/protocol-silence'`.

### 4. Graceful cancellation escalation
When `runtime.cancelTurn(turnId)` is invoked:
1. `TurnLifecycleCoordinator` immediately sets `status: 'cancelling'` and `cancellationRequested = true`.
2. The coordinator calls `agentProvider.cancelTurn({ operation, turnId })`.
3. **Claude / Antigravity**: Adapter sends graceful `SIGINT` to child process; waits up to `cancelGraceMs` (5,000ms); if still running, escalates to forceful `SIGKILL` / `taskkill /T /F`; waits up to `forceGraceMs` (2,000ms).
4. **Codex**: Adapter sends `turn/interrupt` JSON-RPC request to persistent app-server and cancels pending interaction promises; the daemon process remains running.
5. The coordinator settles the turn as `status: 'terminal' (outcome: 'cancelled')`.

### 5. Server shutdown & restart reconciliation
- **Shutdown (`dispose`)**:
  - When the dashboard server terminates, `registry.dispose()` is called.
  - Claude and Antigravity flush pending raw diagnostic writes within bounded timeout (`rawFlushTimeoutMs: 2000`) and terminate active child processes.
  - Codex terminates the persistent `codex app-server` daemon process and unsubscribes all listeners.
- **Boot Reconciliation (`turn-recovery.mjs`)**:
  - Upon server boot, `reconcileOrphanedTurns()` scans `.nevo-ai-local/transcripts/`.
  - Any Turn found with non-terminal status (`active`, `waiting`, `cancelling`) was running when the previous server process stopped.
  - Orphaned turns are deterministically transitioned to `status: 'terminal' (outcome: 'interrupted', cause: 'server-restart')` with `code: 'AI_TURN_INTERRUPTED'`.
  - Dangling tool invocations are closed with `closureReason: 'turn_interrupted'`.
  - Pending interactions with `resumePolicy: 'live-operation'` are marked `interrupted`; interactions with `resumePolicy: 'restart'` remain pending and can be answered.
