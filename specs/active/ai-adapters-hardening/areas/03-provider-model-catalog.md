# Area: Provider model catalog and discovery

## Purpose

Define a provider-neutral model descriptor and catalog architecture that enables model selection, discovery, and capability validation without hardcoding global assumptions into Nevo.

---

## 1. Model classifications and catalog layers

### Current fact
- Currently, `AgentProviderDescriptor` has no model metadata.
- `agy` natively supports dynamic discovery via `agy models`, listing model IDs and labels.
- `claude` accepts `--model <model>` on CLI, but has no discovery command.
- `codex` accepts `-m, --model <MODEL>` on CLI and `model` on `thread/start`, but has no discovery command or RPC.
- Neither Claude nor Codex integration can authoritatively enumerate all models available to the current user/account.

### Proposed target
To preserve truthfulness and prevent false rejections, model information is categorized into four distinct layers:

1. **Authoritative discovered models**:
   - Discovered dynamically by querying the provider CLI at runtime (supported by Antigravity via `agy models`).
   - Cached with a 5-minute TTL to prevent process spawning overhead.
2. **Configured / operator models**:
   - Explicitly configured by the workstation operator in `.nevo-ai-local/ai-providers.yaml`.
   - Allows users to specify private fine-tunes, newly released models, or internal endpoints.
3. **Known / recommended model metadata**:
   - Curated advisory metadata (display labels, known traits) shipped with Nevo for well-known models (e.g. Claude 3.7 Sonnet, o3).
   - Serves as offline fallback and UI label/affordance enrichment.
   - *Static fallback guarantees that catalog metadata and UI suggestions remain available even offline or when dynamic probes time out; it never asserts that the user's specific account or tier can actually execute that model.*
4. **Provider default (omitted override)**:
   - When no model is explicitly requested by the user, Nevo **omits the model override flag / argument entirely**, allowing the provider CLI or daemon to select its native default.
   - Nevo does NOT hardcode a named model as the default unless authoritative provider evidence exists.

### Validation behavior for incomplete catalogs
- **Permissive passthrough**: A stale static baseline must **NOT** cause a valid provider model to be rejected merely because Nevo does not recognize the identifier.
- **No false availability**: A statically known model does **NOT** guarantee that the model is actually accessible to the user's specific account or tier.
- **Validation rule**: If a user specifies a model identifier not found in the local catalog, the adapter emits a warning in traces but passes the model identifier through to the provider CLI. The provider CLI remains the sole authoritative arbiter of model availability and validity.

### Evidence precedence over advisory catalog metadata
- Provider/model metadata may be unknown, incomplete, or outdated.
- **Authoritative runtime evidence always wins over advisory metadata**: if the provider emits a valid normalized reasoning event during turn execution, Nevo accepts and projects it regardless of whether model metadata says true, false, or unknown.
- Model traits are used strictly for **pre-turn configuration and UI affordances** (such as whether to render a reasoning-effort control in the composer).
- Absence of a known trait means **UNKNOWN**, not false.
- Catalog metadata must **NEVER** be used to discard, filter, or suppress evidenced provider output.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 1.*

---

## 2. Model descriptor schema

### Current fact
- Provider descriptors currently contain only top-level booleans and execution modes (`ask`, `edit`, `agent`).

### Proposed target
Every model is represented by an immutable `AgentModelDescriptor`:

```typescript
export interface AgentModelTraits {
  supportsReasoning?: boolean;       // Generates extended provider-exposed reasoning
  supportsReasoningEffort?: boolean; // Accepts low/medium/high effort configuration
  supportsVision?: boolean;          // Accepts multimodal image attachments
  maxContextTokens?: number;         // Maximum input context window (if known)
}

export interface AgentModelDescriptor {
  id: string;                               // Provider-local model identifier (e.g. 'claude-3-7-sonnet-20250219', 'gemini-3.8-flash-high')
  label: string;                            // Human-readable display label
  isDefault?: boolean;                      // True if evidenced as provider default
  source: 'discovered' | 'configured' | 'known'; // Origin of catalog entry
  traits?: AgentModelTraits;                // Advisory model traits for pre-turn UI affordances
}
```

*Notes on responsibility boundaries*:
- `supportedModes` is removed from `AgentModelDescriptor`; execution modes belong to provider/integration policy (configured on `ProviderDescriptor.supportedModes`), not model descriptors.
- Redundant flags such as `toolCalling` on the model are eliminated; tool execution support is governed at the transport level by provider capability `toolCalls`.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 1 and Decision 4.*

---

## 3. Model selection scope

### Current fact
- **Codex**: Accepts `model` during `thread/start` (`v2/ThreadStartParams.json`). Resuming a thread (`v2/ThreadResumeParams.json`) restores the thread with its established model. Turn execution (`v2/TurnStartParams.json`) accepts only `{ input, threadId }` — mid-session model switching is NOT supported by the app-server protocol.
- **Claude**: Accepts `--model <model>`. When resuming an existing session with `--resume <uuid>`, `--model` can be passed, but Claude CLI documentation warns that conversation context is bound to earlier turns.
- **Antigravity**: Accepts `--model <model>` on initial turns and when resuming via `--conversation <id>`.

### Proposed target
- **Session-scoped base**: Model selection is established at session creation (`createSession({ model })`) and recorded in session binding metadata.
- **Turn override constraint**: To prevent protocol violations on Codex, individual turns inherit the session model by default. If turn-level overrides are enabled, they are governed by an explicit adapter capability (`canOverrideTurnModel`) to prevent sending unsupported parameters to providers.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 2.*
