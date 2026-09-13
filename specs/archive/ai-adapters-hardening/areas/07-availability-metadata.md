# Area: Provider availability and metadata

## Purpose

Define the metadata and health state model for AI providers, separating operator configuration from runtime availability, preventing transient per-turn errors from causing global lockouts, and providing non-intrusive diagnostic probing.

---

## 1. State distinctions and decoupled health model

### Current fact
- Currently, `AgentProviderDescriptor` has only `enabled: boolean` and `available: boolean`.
- `enabled` indicates whether the operator configured the provider in `.nevo-ai-local/ai-providers.yaml`.
- `available` indicates whether the binary executable is found in PATH.
- This conflates four distinct operational realities: operator configuration, executable installation, authentication state, and transient operational health.
- Deriving global provider health from a single failed turn causes false-negatives (e.g. a rate limit on one turn marks the entire provider unavailable in the UI).

### Target architecture
Explicitly decouple stable workstation facts from probe-derived observations:

1. **Stable Facts**:
   - `enabled`: Operator configuration in `ai-providers.yaml` (allow-list).
   - `installed`: Binary discovered on host filesystem or PATH.
   - `version`: Discovered CLI version string (e.g. `'0.149.0'`).
2. **Transient Observations**:
   - `authenticated`: Credentials verified. **Must be optional / omitted** unless safely probeable without interactive prompts or billable network calls.
   - `status`: `'healthy' | 'degraded' | 'unavailable'`.
   - `unavailableReason`: Human-readable guidance when status is not healthy.
3. **Turn Error Isolation Invariant**:
   - A per-turn, per-model, or per-account rate limit (HTTP 429) must **NEVER** mark the entire provider descriptor as globally unavailable or uninstalled. Transient turn errors belong to the turn's error outcome, not the provider's installation descriptor.

```typescript
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealth {
  enabled: boolean;                 // Configured in ai-providers.yaml
  installed: boolean;               // Binary discovered on host
  authenticated?: boolean;          // Only present if safely checkable without side-effects
  status: ProviderHealthStatus;     // Current operational health
  version?: string;                 // Discovered CLI version
  unavailableReason?: string;       // Actionable instruction if not healthy
}
```

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 10)**: Decoupling of stable workstation facts from transient health observations and the turn error isolation invariant are adopted.

---

## 2. Probing and caching invariants

### Current fact
- `isAvailable()` probes executables:
  - Claude: `where.exe claude` / `which claude`.
  - Codex: `codex --version` via `defaultProbeCodexExecutable`.
  - Antigravity: `%LOCALAPPDATA%\agy\bin\agy.exe` or `where.exe agy`.
- Probing caches results for 30,000ms (30 seconds).

### Proposed target
1. **Lightweight, Non-Intrusive Probing**:
   - Probes must never make billable model calls, spawn interactive login flows, or block server startup.
   - If authentication cannot be verified locally via existing filesystem credentials or config files without network calls, `authenticated` is left `undefined` (unknown).
2. **Bounded TTL Caching**:
   - Results are cached with a 30-second TTL to avoid process-spawn overhead on every API request.
   - Registry queries (`GET /api/agent-providers`) read from cache unless explicitly requested with cache bypass.
3. **Graceful UI Degradation**:
   - An `enabled: true` provider that is `installed: false` remains visible in provider selectors with clear installation guidance: *"Claude Code CLI is not found in PATH. Run `npm install -g @anthropic-ai/claude-code` to install."*
   - Historical sessions for currently unavailable providers remain readable in the dashboard, with turn dispatch disabled.
