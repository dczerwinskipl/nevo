# Area: Provider model catalog and discovery

## Purpose

Define a provider-neutral model descriptor and catalog architecture that enables model selection, discovery, and capability validation without hardcoding global assumptions into Nevo.

## Neutral model descriptor schema

Every AI model is represented by an immutable `AgentModelDescriptor`:

```typescript
export interface AgentModelCapabilities {
  reasoningEffort?: boolean; // Supports low/medium/high reasoning effort
  vision?: boolean;          // Supports image attachments
  toolCalling?: boolean;     // Supports tool invocations
  maxContextTokens?: number; // Maximum input context window (if known)
}

export interface AgentModelDescriptor {
  id: string;                               // Provider-local model identifier (e.g. 'claude-3-7-sonnet-20250219', 'gemini-3.8-flash-high', 'o3')
  label: string;                            // Human-readable display label (e.g. 'Claude 3.7 Sonnet', 'Gemini 3.8 Flash (High)')
  isDefault?: boolean;                      // True if this is the recommended/default model for the provider
  status?: 'available' | 'preview' | 'deprecated' | 'restricted';
  supportedModes?: AgentExecutionMode[];    // Modes this model supports (defaults to ['ask', 'edit', 'agent'])
  capabilities?: AgentModelCapabilities;    // Model-specific operational capabilities
}
```

## Hybrid catalog architecture (Option C)

To balance immediate availability, offline safety, and live freshness, Nevo adopts a **Hybrid Catalog Strategy**:

### 1. Baseline static catalog
Each provider registers a curated static baseline in its descriptor:
- **Claude Code**:
  - `claude-3-7-sonnet-20250219` (Default: "Claude 3.7 Sonnet (Hybrid Thinking)", reasoningEffort: true)
  - `claude-3-5-sonnet-20241022` ("Claude 3.5 Sonnet", reasoningEffort: false)
  - `claude-3-5-haiku-20241022` ("Claude 3.5 Haiku", reasoningEffort: false)
- **OpenAI Codex**:
  - `o3` (Default: "OpenAI o3", reasoningEffort: true)
  - `o4-mini` ("OpenAI o4-mini", reasoningEffort: true)
  - `gpt-4o` ("GPT-4o", reasoningEffort: false)
- **Google Antigravity**:
  - Initial baseline populated with standard Gemini 3.8 / 3.7 flash and pro models.

### 2. Dynamic runtime discovery (Antigravity)
For providers with native CLI discovery support:
- `AntigravityAgentProvider` implements `discoverModels({ signal })`:
  - Executes `agy models` with a bounded timeout (2,000ms).
  - Parses the tabular stdout (`<id>\t<label>`).
  - Merges discovered models with baseline capabilities.
  - Caches results with a 5-minute TTL to prevent spawning child processes on every API read.
  - If the probe times out or fails (e.g., offline workstation), silently falls back to the static baseline without blocking dashboard operations.

### 3. Operator overrides (`ai-providers.yaml`)
Workstation operators can define or override available models locally in `.nevo-ai-local/ai-providers.yaml`:

```yaml
providers:
  claude:
    enabled: true
    models:
      - id: "claude-3-7-sonnet-20250219"
        label: "Claude 3.7 Sonnet (Primary)"
        isDefault: true
      - id: "my-custom-fine-tuned-model"
        label: "Internal Fine-tuned Model"
```

### 4. Turn execution invocation
When a session or turn specifies a `model`:
- **Claude**: Appends `--model <model>` to `claude -p` command arguments.
- **Codex**: Passes `{ model: <model> }` in `thread/start` or `thread/resume` JSON-RPC parameters.
- **Antigravity**: Appends `--model <model>` to `agy` command arguments.
- **Validation**: If a requested model is not present in the provider's active catalog, the turn start fails fast with `AiValidationError("Model '<model>' is not supported by provider '<provider>'.")`.
