# Area: Operation and process lifecycle

## Purpose

Define strict lifecycle invariants across provider processes, persistent sessions, Nevo turns, and tool invocations, ensuring predictable process cleanup, robust cancellation on Windows, and clean recovery on server restarts.

---

## 1. Four distinct lifecycle domains

### Current fact
- Conflation exists between process lifetime (the running OS child process) and session lifetime (the durable conversation thread).
- In Claude and Antigravity, each turn spawns a separate OS process. In Codex, a single persistent daemon process serves all turns.

### Proposed target
Explicitly decouple four nested lifecycles:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Provider Session Lifetime (Days / Weeks / Months)                     │
│    Correlates to (provider, providerSessionId) across many turns        │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. Provider Process Lifetime (Turn Invocation or Shared Daemon)         │
│    - Claude / Antigravity: Spans ONE turn (spawn -> exit)               │
│    - Codex: Spans server lifecycle (persistent daemon)                  │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. Nevo Turn Lifetime (Seconds to Minutes)                              │
│    User prompt -> Level 2 Work sequence -> FinalAnswer                  │
│    Immutable outcome: completed | failed | cancelled | interrupted      │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. Tool / Activity Lifetime (Milliseconds to Seconds)                   │
│    Individual Level 2 WorkItem + Level 3 ToolAction execution           │
│    Must complete or be sealed before Turn completes                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Child process ownership and process tree termination

### Current fact
- Claude and Antigravity spawn CLI child processes that frequently spawn compound tool subprocesses (compilers, `git`, `bash`, tests).
- Codex app-server client spawns the `codex app-server` daemon child process.
- On Windows, Node.js `child.kill('SIGINT')` or `child.kill('SIGKILL')` calls `TerminateProcess` on the immediate child PID only.
- Grandchild worker processes are NOT terminated and continue running orphaned, locking repository files and consuming CPU.
- On POSIX, terminating a process tree via process group signaling (`process.kill(-pid, signal)`) requires that the child was spawned with `detached: true` to become a process group leader.

### Target architecture
- Implement complete OS-aware process tree lifecycle in `tools/dashboard/server/ai/providers/process-termination.mjs`:
  - **Spawn-side process group establishment**: Expose shared spawn options helper (e.g. `{ detached: process.platform !== 'win32' }`). Claude, Antigravity, and Codex app-server client all use this configuration when spawning child processes.
  - **Kill-side tree termination**:
    - **On Windows**: Invoke `taskkill.exe /PID <pid> /T /F` or assign the spawned child to a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
    - **On POSIX**: Terminate the process group via `process.kill(-pid, signal)`.
  - **Post-termination verification**: Polling check confirms the target PID has ceased execution before resolving the termination promise.
  - **Verification testing**: Automated verification in `process-termination.test.mjs` must not rely solely on mock process wrappers. It must include an integration test that spawns a real parent process that itself spawns a long-running descendant process, terminates the tree via `terminateChildProcess()`, and explicitly verifies via OS liveness checks (`process.kill(pid, 0)`) that both parent and descendant PIDs are dead.
  - **Epistemic boundary**: Confirmed process tree termination proves only that OS process liveness has ended; it does NOT prove the semantic provider result (completed vs failed).

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 9)**: Complete OS-aware process tree lifecycle management (spawn-side process groups, kill-side tree termination, and real parent->descendant automated tests) is adopted across all providers that spawn child processes.

---

## 3. Operation handles and lost execution semantics

### Current fact
- None of the three providers (`claude`, `codex`, `agy`) support detached background operations that can be re-attached or polled after process exit. Turn execution requires an active, uninterrupted communication channel.
- If the communication channel drops or the process disappears unexpectedly, earlier implementations collapsed the turn into `status: 'terminal' (outcome: 'failed')`.
- Indirect signals (such as absence of file writes or filesystem changes) do not prove whether an operation completed, failed, or remains alive.

### Target architecture
- Preserve epistemic truth: if an operation handle vanishes and execution state cannot be proven, the turn transitions to `status: 'unknown'` with `reason: 'operation_lost'` and diagnostic code `AI_OPERATION_LOST`.
- The turn is NOT sealed as completed or failed until authoritative evidence resolves it:
  1. Provider terminal protocol event (e.g. late completion frame with turn correlation).
  2. Provider-supported operation/status query.
- Confirmed PID termination proves only that process liveness has ended; it does not prove a semantic provider outcome.
- Unsafe concurrent turn execution is strictly **blocked** for that session while state is unresolved.
- **Remote recovery and forced cleanup call path**:
  - The operator or remote client initiates recovery via HTTP route -> `AgentSessionService` -> `AgentTurnRuntime` -> provider cancellation / process cleanup -> `TurnLifecycleCoordinator`.
  - The runtime terminates the provider child process tree via `terminateChildProcess()`, confirms process death, and seals the turn lifecycle outcome as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')`.
  - This strictly distinguishes remote forced recovery (`outcome: 'interrupted', cause: 'forced_cleanup'`) from normal user cancellation (`outcome: 'cancelled', initiator: 'user'`), without asserting an unobserved provider outcome.

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 7)**: Epistemic truth preservation, state reconciliation, process-exit precision, and explicit remote forced cleanup call path and semantics are adopted.

---

## 4. Timeout ownership and cancellation escalation

### Current fact
- `TurnLifecycleCoordinator` enforces a 5-minute protocol-silence watchdog.
- Antigravity enforces a provider transport ceiling (`--print-timeout`).

### Proposed target
1. **Timeout Ownership**:
   - **Protocol Silence Watchdog**: Owned by `TurnLifecycleCoordinator`. Evaluates inactivity every 10–30s. Firing arbitrates `AI_RUNTIME_TIMEOUT` and initiates cancellation.
   - **Provider Transport Ceiling**: Owned by provider adapter. If fired, provider reports `AI_PROVIDER_TIMEOUT`.
   - **Precedence**: If runtime watchdog fires, `timeoutRequested = true` takes immutable precedence over late process exit codes.
2. **Graceful Cancellation Escalation**:
   - When `runtime.cancelTurn(turnId)` is invoked:
     1. Coordinator sets `status: 'cancelling'` and `cancellationRequested = true`.
     2. Coordinator invokes adapter `cancelTurn()`.
     3. Adapter issues graceful signal (`SIGINT` on CLI, `turn/interrupt` on Codex); waits up to `cancelGraceMs` (5,000ms).
     4. If still running, adapter escalates to forceful process tree kill (`taskkill /T /F`); waits up to `forceGraceMs` (2,000ms).
     5. Coordinator settles turn as `status: 'terminal' (outcome: 'cancelled')`.

---

## 5. Server shutdown and restart reconciliation

### Current fact
- In `turn-recovery.mjs` (`reconcileOrphanedTurns`):
  - When the server boots, any Turn left in non-terminal status (`active`, `waiting`, `cancelling`) from an ungraceful shutdown is scanned.
  - Active turns are transitioned to `status: 'terminal' (outcome: 'interrupted', cause: 'server-restart')`.
  - Dangling tools are closed with `closureReason: 'turn_interrupted'`.
  - Interactions with `resumePolicy: 'live-operation'` are marked `interrupted`; interactions with `resumePolicy: 'restart'` remain pending.

### Proposed target
- Retain the proven `reconcileOrphanedTurns` invariants.
- On graceful server disposal (`registry.dispose()`):
  - Claude and Antigravity flush pending raw diagnostic queues within bounded timeout (`rawFlushTimeoutMs: 2000`) and terminate child process trees.
  - Codex terminates the persistent `codex app-server` daemon process.
