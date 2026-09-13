# Area: Provider model catalog and discovery

## Purpose

Define a provider-neutral model descriptor and catalog architecture that enables model selection, discovery, and capability validation without hardcoding global assumptions into Nevo.

---

## 1. Model classifications and catalog layers

### Current fact
- Currently, `AgentProviderDescriptor` has no model metadata.
- **Google Antigravity**: `agy` natively supports dynamic discovery via `agy models`, listing model IDs and labels.
- **OpenAI Codex**: Codex app-server v2 protocol natively exposes `model/list` JSON-RPC method, returning `models: Model[]` (`id`, `displayName`, `description`, `isDefault`, `inputModalities`, `supportedReasoningEfforts`, `defaultReasoningEffort`, etc.).
- **Claude Code**: `claude` accepts `--model <model>` on CLI, but has no discovery subcommand or RPC listing method (`claude models` is parsed as an interactive prompt).

### Target architecture
To preserve truthfulness and prevent false rejections, model information is categorized into four distinct layers:

1. **Authoritative discovered models**:
   - Discovered dynamically by querying the provider CLI/daemon at runtime:
     - Antigravity via `agy models` (cached with a 5-minute TTL).
     - Codex via `model/list` JSON-RPC query on `CodexAppServerClient`.
2. **Configured / operator models**:
   - Explicitly configured by the workstation operator in `.nevo-ai-local/ai-providers.yaml`.
   - Allows operators to specify private fine-tunes, newly released models, or custom endpoints.
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

### Model traits evidence rules (Discovered vs Configured vs Unknown)
- For every field on `AgentModelDescriptor` and `AgentModelTraits`, distinguish:
  1. **Authoritatively discovered for that specific model**: Grounded in per-model metadata returned by the provider protocol (e.g. Codex `model/list` exposes `supportedReasoningEfforts` and `defaultReasoningEffort` per model).
  2. **Configured / advisory**: Supplied by operator configuration in `ai-providers.yaml` or curated baseline.
  3. **Unknown (`undefined`)**: When no per-model evidence exists, fields remain `undefined`.
- **Global CLI flags do not imply per-model traits**: The presence of a global CLI option (e.g. `agy --effort` or `claude --model`) proves only transport invocation syntax, NOT per-model capability evidence.
- Because `agy models` outputs only model ID and display label without per-model effort options, `supportedReasoningEfforts` for Antigravity models must be left `undefined` (unknown) rather than manufactured from `--effort`.
- The same rule applies to Claude models: traits not declared in operator configuration remain `undefined`.

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 1)**: Adapter-owned discovery, permissive passthrough, best-available-source principles, and model trait evidence rules are adopted. Nevo core exposes and consumes `AgentModelDescriptor[]` without owning a hardcoded global catalog.

---

## 2. Model descriptor schema

### Current fact
- Provider descriptors currently contain only top-level booleans and execution modes (`ask`, `edit`, `agent`).

### Target architecture
Every model is represented by an immutable `AgentModelDescriptor`:

```typescript
export interface AgentModelTraits {
  supportsReasoning?: boolean;          // Generates extended provider-exposed reasoning
  supportedReasoningEfforts?: string[]; // e.g. ['low', 'medium', 'high']
  defaultReasoningEffort?: string;      // Provider default effort level
  inputModalities?: string[];           // e.g. ['text', 'image', 'audio']
  supportsVision?: boolean;             // Accepts multimodal image attachments
  maxContextTokens?: number;            // Maximum input context window (if known)
}

export interface AgentModelDescriptor {
  id: string;                                  // Provider-local model identifier (e.g. 'claude-3-7-sonnet-20250219', 'gemini-3.8-flash-high')
  label: string;                               // Human-readable display label
  isDefault?: boolean;                         // True if evidenced as provider default
  source: 'discovered' | 'configured' | 'known'; // Origin of catalog entry
  traits?: AgentModelTraits;                   // Advisory model traits for pre-turn UI affordances
}
```

*Notes on responsibility boundaries*:
- `supportedModes` is removed from `AgentModelDescriptor`; execution modes belong to provider/integration policy (configured on `ProviderDescriptor.supportedModes`), not model descriptors.
- Redundant flags such as `toolCalling` on the model are eliminated; tool execution support is governed at the transport level by provider capability `toolCalls`.

### Owner decision resolution
- **Adopted (Approved by Owner — Decisions 1 & 4)**: The `AgentModelDescriptor` and `AgentModelTraits` schemas are adopted.

---

## 3. Model selection scope

### Current fact
- **OpenAI Codex**: In protocol v2, `ThreadStartParams.model` sets initial thread model. `TurnStartParams.model` explicitly defines: *"Override the model for this turn and subsequent turns."* and `TurnStartParams.effort` defines: *"Override the reasoning effort for this turn and subsequent turns."*. Turn-level model and effort switching are natively supported.
- **Google Antigravity**: Accepts `--model <model>` and `--effort <low|medium|high>` on initial turns and when resuming via `--conversation <id>`. Turn-level overrides are natively supported.
- **Claude Code**: Accepts `--model <model>` on initial sessions and on resumed sessions (`--resume <uuid> --model <model>`).

### Target architecture
- **Session-scoped persistence**: Model selection is established at session creation and persisted in session binding metadata (`sessionBinding.model`).
- **Capability-driven turn switching**: Turn-level model switching is governed by an adapter capability: `canOverrideTurnModel: boolean`.
- All three providers (`codex`, `antigravity`, `claude`) natively support turn-level model overrides. Where an adapter supports it, `canOverrideTurnModel` is declared `true`.

### Owner decision resolution
- **Adopted (Approved by Owner — Decision 2)**: Capability-governed model switching is adopted. Nevo does not impose a synthetic session-only restriction where providers natively support turn overrides.
