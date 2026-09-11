# Area: Error and terminal result taxonomy

## Purpose

Establish a comprehensive, discriminated, provider-neutral error and terminal outcome taxonomy. Materially different failures must never collapse into generic 502 errors, enabling deterministic automated retries, fallback routing, quota handling, and user alerting without parsing raw error strings.

---

## Error classification matrix

| Error code | HTTP status | Category | Meaning | Retryable | Downstream action |
|---|---|---|---|---|---|
| `AI_AUTH_FAILED` | 401 | Identity | Provider credentials missing, expired, or invalid. | No | Prompt operator to re-authenticate or run provider login CLI. |
| `AI_POLICY_DENIED` | 403 | Security | Execution blocked by security policy, sandbox rule, or organizational boundary. | No | Escalate to operator; request permission change. |
| `AI_RATE_LIMITED` | 429 | Capacity | Short-term token or request rate limit exceeded (429 / TPM / RPM). | Yes | Exponential backoff using `details.suggestedDelayMs` or handover to alternate model/provider. |
| `AI_QUOTA_EXHAUSTED` | 429 | Capacity | Account billing quota or monthly credit exhausted. | No | Handover to secondary provider or pause execution until billing cycle reset. |
| `AI_PROVIDER_UNAVAILABLE` | 503 | Availability | Provider upstream service unreachable or returning 503/500 service errors. | Yes | Short backoff retry (3-5s) or failover to fallback provider. |
| `AI_TRANSPORT_ERROR` | 502 | Transport | Connection dropped, stdio broken pipe, or network failure between CLI and upstream. | Yes | Reconnect / retry once with clean process spawn. |
| `AI_PROVIDER_TIMEOUT` | 504 | Timeout | Provider CLI transport ceiling fired (e.g. Antigravity `--print-timeout`). | No | Increase provider transport deadline in config if turn was legitimate. |
| `AI_RUNTIME_TIMEOUT` | 504 | Timeout | Nevo protocol-silence watchdog fired (5 min without qualifying activity). | Yes (Conditional) | Investigate hung tool/provider or retry turn. |
| `AI_TURN_CANCELLED` | 409 | Lifecycle | Turn cancelled by explicit user or runtime action. | No | Terminal. Release locks and await next user prompt. |
| `AI_TURN_INTERRUPTED` | 409 | Lifecycle | Turn interrupted by server shutdown, daemon crash, or restart reconciliation. | Yes | Resume turn or prompt user to resend message. |
| `AI_PROTOCOL_ERROR` | 502 | Protocol | Provider emitted malformed JSON, violated JSON-RPC schema, or produced conflicting states. | No | Log diagnostic trace; report bug. |
| `AI_UNSUPPORTED_OPERATION` | 409 | Capability | Operation requested that provider does not support (e.g. `ask_question` on Antigravity). | No | Disable UI capability or adapt workflow. |
| `AI_OPERATION_LOST` | 500 | State | Operation handle vanished or could not be reconciled. | No | Settle turn as failed; re-establish session identity. |
| `AI_PROVIDER_EXECUTION_ERROR` | 502 | Execution | Provider process exited non-zero or reported internal model failure. | Conditional | Inspect stderr / exit code in structured details. |

---

## Three-tier error information boundary

To maintain strict contract hygiene, error information is strictly partitioned into three tiers:

### Tier 1: Public Turn error contract (Browser & API visible)
Exposed in `TurnStatus (status: 'terminal')`, `TerminalOutcome`, and public HTTP responses:
```typescript
interface PublicTurnError {
  code: string;               // Normalized taxonomy code from table above
  message: string;            // Clean, user-safe, provider-neutral explanation
  retryable: boolean;         // Deterministic hint for UI retry button and automated agents
  suggestedDelayMs?: number;  // Present on AI_RATE_LIMITED when upstream supplies Retry-After
}
```
- **Rule**: Raw provider exception strings, stack traces, and CLI paths are FORBIDDEN in Tier 1.

### Tier 2: Structured orchestration metadata (Server-internal & API `details`)
Available on `AiError.details` for orchestration, retry supervisors, and operator diagnostics:
```typescript
interface StructuredErrorDetails {
  source: 'provider_cli' | 'app_server' | 'nevo_runtime' | 'nevo_coordinator';
  provider: string;
  exitCode?: number;
  timeoutKind?: 'provider_transport' | 'protocol_silence' | 'startup';
  configuredSeconds?: number;
  retryable: boolean;
  suggestedDelayMs?: number;
}
```
- **Rule**: Bounded, normalized objects only. No raw provider request IDs or auth tokens.

### Tier 3: Diagnostic raw capture & trace logs (Server filesystem only)
- Complete, verbatim stdout/stderr lines recorded in `.nevo-ai-local/<provider>_raw/<sessionId>/raw.ndjson`.
- Chronological transition audit records in `LifecycleTraceSink`.
- **Rule**: Accessible only via server filesystem or authenticated operator diagnostic export; never broadcast over public SSE.

---

## Deterministic terminal arbitration invariants

Regardless of provider timing or process exit quirks, `TurnLifecycleCoordinator` enforces deterministic terminal arbitration:
1. **Timeout Precedence**: If `timeoutRequested` was set by runtime watchdog, the turn outcome is IMMUTABLY `failed` with `cause: 'timeout/protocol-silence'` and `code: 'AI_RUNTIME_TIMEOUT'`, even if the provider child process subsequently exits with code 0 or returns a late completion result.
2. **Cancellation Precedence**: If `cancellationRequested` was accepted, the turn outcome is IMMUTABLY `cancelled` with `initiator: 'user'` and `code: 'AI_TURN_CANCELLED'`, even if the provider rejects with a process termination error.
3. **Immutability**: Once a Turn transitions to `status: 'terminal'`, no subsequent event, delta, or error from the provider may alter its status, outcome, or error code. Late events are recorded in diagnostic traces as `ignored`.
