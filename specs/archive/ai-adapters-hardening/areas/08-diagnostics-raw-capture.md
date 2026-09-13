# Area: Diagnostics and raw capture

## Purpose

Define the strict boundary between canonical provider-neutral conversation state and raw provider diagnostics, establishing durability, session correlation, redaction, and retention invariants.

---

## 1. Canonical history vs raw diagnostics boundary

### Current fact
- Canonical conversation history is stored in `.nevo-ai-local/transcripts/` as sanitized, provider-neutral JSON.
- Raw provider stdout/stderr logs are stored in `.nevo-ai-local/*_raw/`.
- Antigravity adapter contains a provisional-to-allocated directory migration mechanism when `agy` allocates an ID during streaming.

### Target architecture
Maintain a strict separation of concerns between user-facing state and diagnostic forensics:

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

#### Diagnostic invariants
1. **No Browser Exposure**: Raw stdout/stderr lines, JSON-RPC envelopes, and provider request IDs must NEVER be sent over public HTTP endpoints or SSE streams.
2. **Failure Isolation**: Disk write failures or serialization errors encountered while persisting raw diagnostics must NEVER fail, abort, or delay active Turn execution. Diagnostic writes run in isolated promise queues with error suppression.
3. **Bounded Flushing**: When a Turn completes, errors, or is cancelled, a bounded flush (`flushRawCaptureBounded(sessionId)`) awaits pending writes up to `rawFlushTimeoutMs` (2,000ms). If the timeout expires, the turn returns while writes continue in the background.
4. **Dual Identity Correlation**: Every recorded line in `raw.ndjson` carries both the canonical provider session ID and the turn ID:
   ```json
   {
     "capturedAt": "2026-09-12T08:00:00.000Z",
     "stream": "stdout",
     "providerSessionId": "c_987654321",
     "turnId": "turn-12345",
     "raw": { "type": "step_update", "step_type": "tool", "tool_name": "run_command" }
   }
   ```
5. **Sanitized Directory Naming**: Session directory names are sanitized via `rawCaptureSessionDirectory(sessionId)` with Windows reserved-name protection and SHA-256 fallback for invalid characters.
6. **Sensitivity & Privacy**: Raw diagnostic logs may contain repository paths, prompt contents, or environment details. All raw capture directories (`.nevo-ai-local/*_raw/`) must remain ignored by Git (`.gitignore`).

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 8)**: The diagnostic boundary is adopted. Session alias persistence (`antigravity-sessions.json`) is preserved and encapsulated within the Antigravity adapter boundary, avoiding unnecessary migration or consolidation into core services.
