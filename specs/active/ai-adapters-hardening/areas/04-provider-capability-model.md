# Area: Provider capability model

## Purpose

Deconstruct the current unstructured boolean capabilities map (`AgentCapabilities`) into clean, distinct architectural domains: Provider Transport Capabilities, Model Inference Traits, Execution Modes, and Runtime Availability.

---

## 1. Domain responsibility separation

### Current fact
- `AgentCapabilities` in `tools/dashboard/server/ai/contracts.mjs` defines a flat list of 10 booleans:
  `interactivePermissions`, `interactiveQuestions`, `interactiveConfirmations`, `resumeSession`, `cancelTurn`, `toolCalls`, `reasoning`, `usage`, `steerTurn`, `planUpdates`.
- This mixes transport/protocol abilities of the adapter with intrinsic inference properties of AI model weights.
- Moving `reasoning` exclusively to the model level breaks transport checks (if an adapter cannot stream reasoning events from the CLI, model support alone is insufficient).
- Duplicating flags like `toolCalls` (provider) and `toolCalling` (model) creates overlapping, undefined semantics.

### Proposed target
Establish explicit responsibility boundaries between transport capabilities and model traits:

```mermaid
classDiagram
    class ProviderDescriptor {
        +string id
        +string label
        +ProviderCapabilities capabilities
        +ModelDescriptor[] models
        +ExecutionMode[] supportedModes
        +ProviderHealth health
    }
    class ProviderCapabilities {
        +boolean interactivePermissions
        +boolean interactiveQuestions
        +boolean interactiveConfirmations
        +boolean resumeSession
        +boolean cancelTurn
        +boolean toolCalls
        +boolean reasoningEvents
        +boolean usage
        +boolean steerTurn
        +boolean planUpdates
    }
    class ModelDescriptor {
        +string id
        +string label
        +ModelTraits traits
    }
    class ModelTraits {
        +boolean supportsReasoning
        +boolean supportsReasoningEffort
        +boolean supportsVision
        +number maxContextTokens
    }
    class ExecutionMode {
        <<enumeration>>
        ask
        edit
        agent
    }
    class ProviderHealth {
        +boolean enabled
        +boolean installed
        +boolean authenticated
        +string status
        +string unavailableReason
    }

    ProviderDescriptor *-- ProviderCapabilities
    ProviderDescriptor *-- ModelDescriptor
    ProviderDescriptor *-- ExecutionMode
    ProviderDescriptor *-- ProviderHealth
    ModelDescriptor *-- ModelTraits
```

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 4.*

---

## 2. Transport capabilities vs model traits

### Current fact
- Adapters currently declare capabilities monolithically. For example, Claude declares `reasoning: true` even though earlier Claude 3.5 models do not emit thinking blocks.

### Proposed target
1. **Transport / Integration Capabilities (`ProviderCapabilities`)**:
   - Inherent to the adapter transport and CLI integration protocol.
   - `interactiveQuestions`: Transport can conduct mid-turn question interactions.
   - `interactivePermissions`: Transport can conduct mid-turn tool permission interactions.
   - `interactiveConfirmations`: Transport can conduct mid-turn confirmation interactions.
   - `resumeSession`: Transport supports multi-turn session continuation across process exits.
   - `cancelTurn`: Transport supports graceful in-flight cancellation.
   - `toolCalls`: Transport can parse and stream structured tool invocations. (Sole authoritative flag for tool calling; no duplicate on model).
   - `reasoningEvents`: Transport can capture and stream `reasoning.delta` events from the CLI/daemon stream.
   - `usage`: Transport reports token consumption and cost telemetry.
   - `steerTurn`: Transport supports mid-turn prompt redirection.
   - `planUpdates`: Transport emits structured plan or task progress.

2. **Model Traits (`ModelTraits`)**:
   - Intrinsic to specific AI model weights and training.
   - `supportsReasoning`: Model produces provider-exposed reasoning tokens.
   - `supportsReasoningEffort`: Model accepts `low`, `medium`, or `high` reasoning effort configuration (e.g. Claude 3.7 Sonnet, Gemini 2.0 Flash Thinking, o3).
   - `supportsVision`: Model accepts multimodal image attachments.
   - `maxContextTokens`: Maximum context window size.
   - *Absence of a trait means UNKNOWN, not false.*

3. **Effective Turn Behavior and Evidence Precedence**:
   - Provider and model catalog metadata may be unknown or incomplete.
   - **Authoritative runtime evidence always wins over advisory metadata**: if the provider emits a valid normalized reasoning event, Nevo accepts and projects it regardless of whether model metadata says true, false, or unknown.
   - Model traits are used for **pre-turn configuration and UI affordances** (such as whether to offer a reasoning-effort selector in the composer or model options).
   - Catalog metadata must **NEVER** be used to discard, filter, or suppress evidenced provider output.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 4.*

---

## 3. Execution mode policy (`ExecutionMode`)

### Current fact
- `AGENT_EXECUTION_MODES` in `contracts.mjs` defines `['ask', 'edit', 'agent']` with default `'edit'`.
- Execution mode is not a provider capability or model trait; it is an operator security policy passed to the provider to configure sandbox restrictions and approval boundaries:
  - `ask` (Read-only): Sandboxed, no file writes or mutating commands. (Codex: `sandbox: 'read-only'`; Claude: `--permission-mode plan`; Antigravity: `--mode=plan`).
  - `edit` (Workspace write with safeguards): Modifies repository workspace files. (Codex: `sandbox: 'workspace-write'`; Claude: `--permission-mode acceptEdits`; Antigravity: `--mode=accept-edits`).
  - `agent` (Autonomous with escalation): Full workspace access with command execution. (Codex: `on-request` approval; Claude: `--permission-mode bypassPermissions`; Antigravity: `--mode=accept-edits --dangerously-skip-permissions`).

### Proposed target
- Maintain `ExecutionMode` as a first-class policy orthogonal to provider capabilities and model traits.
- The provider descriptor declares `supportedModes: AgentExecutionMode[]` indicating which modes the adapter currently maps. Model descriptors do NOT carry `supportedModes`.
