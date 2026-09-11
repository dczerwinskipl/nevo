# Area: Normalized output and response semantics

## Purpose

Define strict, provider-neutral semantics for all AI agent output channels, eliminating client-side heuristics and ensuring consistent representation across Claude Code, OpenAI Codex, and Google Antigravity.

## Architectural invariants

### 1. Three-level Work hierarchy & orthogonal FinalAnswer
Execution activity within any Turn adheres strictly to the canonical three-level hierarchy (ADR-0008):
- **Level 1 (Turn)**: The root execution unit for a user prompt, with immutable terminal outcomes (`completed`, `failed`, `cancelled`, `interrupted`).
- **Level 2 (WorkItem)**: Chronologically ordered, strongly typed, monotonically sequenced items (`commentary`, `reasoning`, `tool`, `interaction`). Items maintain immutable sequence numbers (`seq >= 1`) and cannot mutate their `type`.
- **Level 3 (ToolAction)**: Ordered sub-actions within a `tool` WorkItem representing compound operations (read, edit, execute) without inflating the top-level turn `activityCount`.
- **FinalAnswer**: Kept in an orthogonal property on `CanonicalTurn` (`finalAnswer: FinalAnswer | null`), strictly decoupled from Level 2 Work items. Commentary cannot morph into FinalAnswer merely because a turn ends.

### 2. Stream channel semantics & AgentEvent audit
The existing `AgentEvent` vocabulary is sufficient and must NOT be replaced with a competing response model. However, adapters must adhere to unambiguous channel mappings:

| Channel / Event | Semantic meaning | Target model representation | UI rendering surface |
|---|---|---|---|
| `final_answer.delta` / `text.delta` | Authoritative conversational content intended for the user | `turn.finalAnswer.text` | Assistant chat bubble (`FinalAnswerBubble`) |
| `progress.delta` / `commentary.delta` | Transient execution commentary, step narration, or status reporting | `WorkItem (type: 'commentary')` | Work panel commentary card (`TurnWorkPanel`) |
| `reasoning.delta` | Model internal chain-of-thought or thinking process | `WorkItem (type: 'reasoning')` | Collapsible reasoning card (`ReasoningCard`) |
| `tool.started`, `.updated`, `.completed` | Tool execution lifecycle | `WorkItem (type: 'tool')` + `actions` | Tool invocation card (`ToolInvocationCard`) |
| `interaction.requested`, `.resolved` | User input requested or provided | `WorkItem (type: 'interaction')` | Interactive prompt card (`InteractionPrompt`) |
| `usage.updated` | Token consumption and cost telemetry | `turn.usage` | Session header & turn footer telemetry |
| `turn.completed`, `turn.failed` | Immutable terminal lifecycle transition | `turn.status (status: 'terminal')` | Turn status badge & elapsed timer seal |

### 3. Elimination of text heuristics
- **Zero Regex Parsing**: The UI and runtime must NEVER parse Markdown or free-form text using heuristics to detect tool calls, questions, approvals, or errors.
- **Evidenced Transitions**: A state transition to `requiresAttention` requires an explicit, structured `interaction.requested` event from the provider adapter.
- **Terminal Text Questions**: If a model ends a turn with a conversational question (e.g., *"Should I proceed with option A or B?"*), it is treated as normal `finalAnswer` text, ending the turn cleanly in `status: 'terminal' (outcome: 'completed')`. The user answers by typing in the composer, which starts a new Turn. It must NEVER fabricate an `interaction` WorkItem or hang in `requiresAttention`.

### 4. Authoritative tool closure
- Tools that are still active or queued when a Turn reaches a terminal boundary must be authoritatively closed by the coordinator with `status: 'failed'` and an explicit `closureReason` (`turn_completed`, `turn_failed`, `turn_cancelled`, `turn_interrupted`, `process_exit`, `timeout`).
- No tool invocation may remain in `active` or `queued` status once the owning Turn is terminal.
