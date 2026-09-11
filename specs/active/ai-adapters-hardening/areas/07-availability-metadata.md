# Area: Provider availability and metadata

## Purpose

Define the metadata and health state model for AI providers, eliminating the conflation of operator configuration with runtime availability, and providing actionable diagnostic reasons when a provider cannot be used.

---

## State distinctions

The current boolean pair (`enabled`, `available`) conflates four distinct operational realities:
1. Did the operator grant permission to use this provider on this workstation?
2. Is the CLI executable installed on the host machine?
3. Are the provider credentials or login sessions authenticated?
4. Is the provider currently functional, or is it temporarily degraded by rate limits or upstream outages?

### Normalized provider health contract

The provider descriptor contract is extended to represent these states cleanly:

```typescript
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealth {
  enabled: boolean;                 // Configured in .nevo-ai-local/ai-providers.yaml
  installed: boolean;               // Binary discovered on host filesystem or PATH
  authenticated?: boolean;          // Authentication credentials confirmed (when probeable)
  status: ProviderHealthStatus;     // Overall operational health
  version?: string;                 // Discovered CLI version (e.g. '0.149.0', '1.1.23')
  unavailableReason?: string;       // Actionable instruction if status !== 'healthy'
  retryAfterMs?: number;            // Backoff delay if temporarily degraded (e.g. rate limit)
}
```

---

## Probing & caching invariants

1. **Lightweight, Non-Intrusive Probing**:
   - `isAvailable()` probes must never make billable model calls or spawn slow interactive processes.
   - **Claude**: Probes executable presence via `where.exe claude` (Windows) / `which claude` (POSIX). Does not run heavy network commands.
   - **Codex**: Probes executable via `codex --version` using Windows `.cmd` resolution (`resolveCodexCommand()`). Extracts version string.
   - **Antigravity**: Probes standard installation path (`%LOCALAPPDATA%\agy\bin\agy.exe` on Windows) or PATH via `where.exe agy`.

2. **Bounded TTL Caching**:
   - Probing the filesystem or spawning `--version` commands carries process creation overhead (10–50ms on Windows).
   - Providers cache availability probe results for a default TTL of 30,000ms (30 seconds).
   - Registry queries (`GET /api/agent-providers`) read from cache unless explicitly requested with cache bypass.

3. **Graceful UI Degradation**:
   - An `enabled: true` provider that is `installed: false` is visible in the provider list with a clear installation badge and guidance: *"Claude Code CLI is not found in PATH. Run `npm install -g @anthropic-ai/claude-code` to install."*
   - Existing historical sessions whose provider is now `unavailable` remain browsable and readable in the dashboard. However, the session composer and turn dispatch are disabled with `readiness.status: 'unavailable'`.

4. **Configuration Allow-list**:
   - If `.nevo-ai-local/ai-providers.yaml` is absent, empty, or has no enabled entries, no AI provider is registered.
   - The dashboard session creation surfaces explain how to create the local configuration file rather than silently crashing or failing.
