# Area: Error and terminal result taxonomy

## Purpose

Establish a comprehensive, discriminated, provider-neutral error and failure taxonomy that separates terminal lifecycle outcomes from failure classification, preserving epistemic truth and providing structured recovery hints for downstream orchestration.

---

## 1. Separation of terminal outcomes, failure codes, and recovery hints

### Current fact
- In `tools/dashboard/server/ai/model/turn-status.mjs`, `TERMINAL_OUTCOMES` defines four immutable outcomes:
  `completed`, `failed`, `cancelled`, `interrupted`.
- `TURN_STATUSES` also includes a distinct non-terminal state: `status: 'unknown'`.
- In current provider adapters, diverse failures (invalid credentials, rate limits, billing quota, network drops, CLI exit 1, and lost process handles) collapse into generic `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502).
- Cancellation and server restart are sometimes conflated with request errors, obscuring normal lifecycle terminations.

### Proposed target
Strictly decouple three orthogonal concepts:
1. **Terminal Outcome**: The lifecycle resolution of the Turn (`completed`, `failed`, `cancelled`, `interrupted`). Cancellation is initiated by user/system intent; interruption is caused by server restart; neither is an error.
2. **Normalized Failure / Reason Code**: Categorical diagnostic reason explaining why a turn failed, was aborted, or became lost.
3. **Structured Recovery Hint**: Neutral facts and hints guiding downstream automated supervisors or user actions without hardcoding complex orchestration policy inside the adapter.

#### Neutral recovery hints
- `'none'`: Permanent or deliberate failure; do not retry.
- `'retry-after-delay'`: Transient capacity or transport error; retry after backoff (respects `suggestedDelayMs`).
- `'new-turn'`: The previous turn failed cleanly; user or agent may dispatch a new prompt in the same session.
- `'new-session'`: Session state is corrupted or unmaterialized; caller must create a new session.
- `'operator-action'`: Action required by workstation operator (e.g. login CLI, update config, grant permissions).
- `'alternate-provider'`: Quota or model unavailable; caller should route to a secondary provider.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 6.*

---

## 2. Normalized failure classification matrix

### Proposed target

| Code | HTTP | Category | Meaning | Recovery hint | Downstream action |
|---|---|---|---|---|---|
| `AI_AUTH_FAILED` | 401 | Identity | Provider credentials missing, expired, or invalid. | `operator-action` | Prompt operator to re-authenticate CLI. |
| `AI_POLICY_DENIED` | 403 | Security | Blocked by sandbox, approval policy, or organization rule. | `operator-action` | Request elevated permissions or adjust mode. |
| `AI_RATE_LIMITED` | 429 | Capacity | Short-term token or request rate limit exceeded (TPM/RPM). | `retry-after-delay` | Backoff using `suggestedDelayMs` or switch model. |
| `AI_QUOTA_EXHAUSTED` | 429 | Capacity | Account billing quota or monthly credit exhausted. | `alternate-provider` | Route to secondary provider or pause execution. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | Availability | Upstream service unreachable or returning 503/500 errors. | `retry-after-delay` | Short backoff retry (3-5s) or fallback provider. |
| `AI_TRANSPORT_ERROR` | 502 | Transport | Broken stdio pipe, network drop between CLI and upstream. | `retry-after-delay` | Reconnect / retry with clean process spawn. |
| `AI_PROVIDER_TIMEOUT` | 504 | Timeout | Provider CLI transport ceiling fired (e.g. `--print-timeout`). | `none` | Increase transport deadline in config if legitimate. |
| `AI_RUNTIME_TIMEOUT` | 504 | Timeout | Nevo protocol-silence watchdog fired (5 min without activity). | `new-turn` | Check for hung tools; resubmit turn. |
| `AI_PROTOCOL_ERROR` | 502 | Protocol | Malformed JSON, schema violation, or conflicting states. | `new-session` | Log diagnostic trace; report bug. |
| `AI_UNSUPPORTED_OPERATION` | 409 | Capability | Requested operation not supported by provider transport. | `none` | Disable UI capability or adapt workflow. |
| `AI_OPERATION_LOST` | 500 | State | Operation handle lost; state cannot be proven. | `none` | Transition to `status: 'unknown'`; do not claim failed. |
| `AI_PROVIDER_EXECUTION_ERROR` | 502 | Execution | Provider process exited non-zero or crashed internally. | `new-turn` | Inspect exit code / stderr in structured details. |

*Note*: Cancellation (`outcome: 'cancelled'`) and server restart interruption (`outcome: 'interrupted'`) are lifecycle outcomes; when recorded in audit logs, they carry reasons (`user_cancelled`, `server_restart`), not failure codes.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 6.*

---

## 3. Lost and unknown operation semantics (Epistemic truth)

### Current fact
- When an operation drops (e.g. process disappears without exit event, pipe disconnects), current adapters sometimes settle the turn as `status: 'terminal' (outcome: 'failed')`.
- The turn status enum in `turn-status.mjs` explicitly defines `status: 'unknown'`.
- Indirect signals (such as workspace changes or absence of file writes) do **NOT** prove whether a provider operation completed, failed, or remains alive.
- Epistemic reality: if the process handle is lost, the operation may still be running in the background, or it may have completed without sending a close frame. Calling it `failed` is false.

### Proposed target
1. **Preserve Epistemic Truth**:
   - If an operation handle vanishes and execution state cannot be proven, the turn transitions to `status: 'unknown'` with `reason: 'operation_lost'` and diagnostic code `AI_OPERATION_LOST`.
   - Nevo does **NOT** set `terminalOutcome`. Unknown means unknown.
   - Unsafe concurrent turn execution is strictly **blocked** for that session while state is unresolved, preventing conflicting edits or out-of-order execution.
2. **Authoritative Reconciliation Evidence**:
   - Only authoritative evidence can resolve an unproven state:
     - Provider terminal protocol event (e.g. late completion/failure notification with verified turn correlation).
     - Confirmed provider process exit (verified by OS process check confirming the specific PID is terminated).
     - Provider-supported operation/status query (where the protocol natively supports status interrogation).
     - Another transport-specific authoritative signal.
3. **Handling Forced Cleanup**:
   - If no authoritative provider evidence arrives and Nevo intentionally performs forced cleanup/termination to recover session control (e.g. operator cancellation or recovery supervisor terminating the process tree):
   - Nevo records the lifecycle result as `terminal (outcome: 'interrupted', cause: 'forced_cleanup')` only after process tree termination is proven, without claiming an unknown provider result.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 7.*

---

## 4. Three-tier error information boundary

### Proposed target

#### Tier 1: Public Turn error contract (Browser & API visible)
```typescript
interface PublicTurnError {
  code: string;               // Normalized failure code from table above
  message: string;            // Clean, user-safe explanation (no raw dumps)
  recoveryHint: string;       // Actionable hint for UI / caller
  suggestedDelayMs?: number;  // Present on rate limits when retry-after is known
}
```

#### Tier 2: Structured orchestration metadata (Server-internal & API `details`)
```typescript
interface StructuredErrorDetails {
  source: 'provider_cli' | 'app_server' | 'nevo_runtime' | 'nevo_coordinator';
  provider: string;
  exitCode?: number;
  timeoutKind?: 'provider_transport' | 'protocol_silence' | 'startup';
  configuredSeconds?: number;
  recoveryHint: string;
  suggestedDelayMs?: number;
}
```

#### Tier 3: Diagnostic raw capture & trace logs (Server filesystem only)
- Complete stdout/stderr lines stored in `.nevo-ai-local/*_raw/<session>/raw.ndjson`.
- Internal trace events in `LifecycleTraceSink`. Forbidden from public API/SSE streams.

---

## 5. Deterministic terminal arbitration invariants

### Proposed target
1. **Timeout Precedence**: If runtime watchdog fires (`timeoutRequested = true`), the turn settles with `cause: 'timeout/protocol-silence'` and `code: 'AI_RUNTIME_TIMEOUT'`, even if the provider process subsequently exits with code 0.
2. **Cancellation Precedence**: If cancellation is accepted (`cancellationRequested = true`), the turn settles as `outcome: 'cancelled'` with `initiator: 'user'`, even if the provider rejects with a process termination error.
3. **Immutability**: Once a Turn transitions to `status: 'terminal'`, no subsequent event, delta, or late process exit from the provider may alter its status, outcome, or error code. Late events are logged in traces as `ignored`.
