# Area: Diagnostics and raw capture

## Purpose

Define the strict boundary between canonical provider-neutral conversation state and raw provider diagnostics, establishing durability, session correlation, redaction, and retention invariants.

---

## Canonical history vs raw diagnostics boundary

```text
┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│       Canonical Turn & Work History          │  │           Raw Provider Diagnostics           │
├──────────────────────────────────────────────┤  ├──────────────────────────────────────────────┤
│ • Level 1-3 Turn and Work items             │  │ • Exact stdout/stderr/stdin byte lines      │
│ • Persisted under .nevo-ai-local/transcripts/│  │ • Stored under .nevo-ai-local/<prov>_raw/   │
│ • Sanitized, provider-neutral schemas        │  │ • Contains raw provider-private IDs & JSON  │
│ • Authoritative source of conversation truth │  │ • Operator diagnostic forensics only         │
│ • Broadcast to browser over HTTP/SSE         │  │ • FORBIDDEN from browser visibility / API    │
└──────────────────────────────────────────────┘  └──────────────────────────────────────────────┘
```

### Invariant 1: No browser exposure of raw payloads
- Raw stdout lines, JSON-RPC envelopes, provider request IDs, and internal error stacks must NEVER be exposed over public HTTP endpoints or SSE event streams.
- The UI renders only canonical Work items, tool actions, and normalized error summaries.

### Invariant 2: Failure isolation
- File write failures, disk-full conditions, or serialization errors encountered while persisting raw diagnostics must NEVER fail, abort, or delay active Turn execution.
- Diagnostic operations run in isolated promise queues (`#sessionWriteQueues`) with error suppression and console warnings.

### Invariant 3: Bounded flushing on lifecycle boundaries
- When a Turn completes, errors, or is cancelled, the adapter triggers a bounded flush (`flushRawCaptureBounded(sessionId)`).
- The flush awaits pending disk writes up to `rawFlushTimeoutMs` (default 2,000ms). If the timeout elapses, the turn returns immediately while writes continue in the background.
- On dashboard shutdown (`dispose()`), all provider raw queues are flushed with a bounded timeout before child processes are terminated.

### Invariant 4: Dual identity correlation
- Every recorded line in `raw.ndjson` is an envelope carrying both the canonical provider session ID and the turn ID:
```json
{
  "capturedAt": "2026-09-11T21:45:00.000Z",
  "stream": "stdout",
  "providerSessionId": "c_987654321",
  "turnId": "turn-12345",
  "raw": { "type": "step_update", "step_type": "tool", "tool_name": "run_command" }
}
```
- Each session directory contains a companion `session.json` metadata file:
```json
{
  "provider": "antigravity",
  "providerSessionId": "c_987654321"
}
```

### Invariant 5: Directory naming & collision resistance
- The session directory segment is sanitized via `rawCaptureSessionDirectory(sessionId)`:
  - Valid alphanumeric segments (`^[a-zA-Z0-9_-]+$`, not reserved Windows names like `CON`, `PRN`, `AUX`, `NUL`) are used directly.
  - Case-collision checks protect against Windows case-insensitive filesystem collisions.
  - Complex or unsafe IDs are hashed using SHA-256 (`<prefix>-<hash16>`) to prevent directory traversal or file injection.

### Invariant 6: Sensitivity & operator ownership
- Raw diagnostic logs contain prompts, codebase files, environment paths, and potentially credentials or API keys.
- All raw capture directories (`.nevo-ai-local/*_raw/`) must be explicitly ignored by Git (`.gitignore`).
- Raw capture is disabled by default and enabled per provider via `.nevo-ai-local/ai-providers.yaml`.
