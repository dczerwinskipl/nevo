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
- On Windows, Node.js `child.kill('SIGINT')` or `child.kill('SIGKILL')` calls `TerminateProcess` on the immediate child PID only.
- Grandchild worker processes are NOT terminated and continue running orphaned, locking repository files and consuming CPU.

### Proposed target
- Harden `terminateChildProcess()` in `tools/dashboard/server/ai/sessions/turns/process-termination.mjs`:
  - **On Windows**: Invoke `taskkill.exe /PID <pid> /T /F` or assign the spawned child to a Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
  - **On POSIX**: Spawn with `detached: true` and terminate the process group via `process.kill(-pid, signal)`.
  - Verification loop ensures all processes in the tree have exited before completing termination promise.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 9.*

---

## 3. Operation handles and lost execution semantics

### Current fact
- None of the three providers (`claude`, `codex`, `agy`) support detached background operations that can be re-attached or polled after process exit. Turn execution requires an active, uninterrupted communication channel.
- If the communication channel drops or the process disappears unexpectedly, earlier implementations collapsed the turn into `status: 'terminal' (outcome: 'failed')`.
- Indirect signals (such as absence of file writes or filesystem changes) do not prove whether an operation completed, failed, or remains alive.

### Proposed target
- Preserve epistemic truth: if an operation handle vanishes and execution state cannot be proven, the turn transitions to `status: 'unknown'` with `reason: 'operation_lost'` and diagnostic code `AI_OPERATION_LOST`.
- The turn is NOT sealed as failed until authoritative evidence resolves it:
  1. Provider terminal protocol event (e.g. late completion frame with turn correlation).
  2. Confirmed provider process exit (verified by OS process check that the specific PID has terminated).
  3. Provider-supported operation/status query.
- Unsafe concurrent turn execution is strictly **blocked** for that session while state is unresolved.
- If Nevo intentionally performs forced cleanup/termination to recover session control, Nevo records its own lifecycle result as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')` once termination is proven, without asserting an unknown provider outcome.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 7.*

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
  - Active turns are transitioned to `status: 'terminal' (outcome: 'interrupted', cause: 'server-restart')` with code `AI_TURN_INTERRUPTED`.
  - Dangling tools are closed with `closureReason: 'turn_interrupted'`.
  - Interactions with `resumePolicy: 'live-operation'` are marked `interrupted`; interactions with `resumePolicy: 'restart'` remain pending.

### Proposed target
- Retain the proven `reconcileOrphanedTurns` invariants.
- On graceful server disposal (`registry.dispose()`):
  - Claude and Antigravity flush pending raw diagnostic queues within bounded timeout (`rawFlushTimeoutMs: 2000`) and terminate child process trees.
  - Codex terminates the persistent `codex app-server` daemon process.
