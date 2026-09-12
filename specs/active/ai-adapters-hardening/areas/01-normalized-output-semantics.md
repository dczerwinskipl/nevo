# Area: Normalized output and response semantics

## Purpose

Define strict, provider-neutral semantics for all AI agent output channels, eliminating client-side heuristics and establishing explicit event transformation layers across Claude Code, OpenAI Codex, and Google Antigravity.

---

## 1. Output and event transformation layers

### Current fact
- The public `AgentEvent` contract in `tools/dashboard/server/ai/contracts.mjs` defines:
  `turn.started`, `turn.updated`, `message.started`, `text.delta`, `progress.delta`, `reasoning.delta`, `tool.started`, `tool.updated`, `tool.completed`, `interaction.requested`, `interaction.resolved`, `usage.updated`, `turn.completed`, `turn.failed`.
- The runtime implementation uses internal semantic names: `final_answer.delta` and `commentary.delta`.
- Each provider protocol emits private events:
  - **Codex**: JSON-RPC notifications (`v2/AgentMessageDeltaNotification` with `phase: 'commentary' | 'final_answer'`, `v2/ReasoningTextDeltaNotification`, `v2/ItemStartedNotification`).
  - **Claude**: Stream-json events (`content_block_delta` with `text_delta` or `thinking_delta`, `tool_use`, `result`).
  - **Antigravity**: NDJSON lines (`step_update.thought` / `thinking`, `step_update.step_type: 'tool'`, `assistant` text).
- `CanonicalTurn` in `tools/dashboard/server/ai/model/canonical-turn.mjs` projects output into Level 1 Turn, Level 2 `WorkItem` (`commentary`, `reasoning`, `tool`, `interaction`), Level 3 `ToolAction`, and an orthogonal `finalAnswer: FinalAnswer | null`.

### Proposed target
To eliminate ambiguity, output semantics are structured as a strict four-layer transformation pipeline:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Provider-Specific Protocol Events                                  │
│ (Raw bytes, CLI stream-json, NDJSON lines, or daemon JSON-RPC envelopes)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Adapter parsing & phase mapping
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Internal Runtime Semantic Events                                   │
│ (final_answer.delta, commentary.delta, reasoning.delta, tool, interaction)   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Normalization & sequence allocation
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Public AgentEvent Stream (Server-Sent Events / SSE)                │
│ (text.delta, progress.delta, reasoning.delta, tool.*, interaction.*, etc.)  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Projection & accumulator
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 4: CanonicalTurn Projection                                           │
│ (turn.finalAnswer, turn.work: WorkItem[], turn.status, turn.terminalOutcome)│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Layer vocabulary mapping

| Semantic channel | Layer 2 (Internal Runtime) | Layer 3 (Public AgentEvent) | Layer 4 (CanonicalTurn) | Semantic rendering target |
|---|---|---|---|---|
| Conversational final response | `final_answer.delta` | `text.delta` | `turn.finalAnswer.text` | Assistant chat bubble surface |
| Execution narration / progress | `commentary.delta` | `progress.delta` | `WorkItem (type: 'commentary')` | Activity / work log card |
| Provider-exposed reasoning | `reasoning.delta` | `reasoning.delta` | `WorkItem (type: 'reasoning')` | Collapsible reasoning disclosure |
| Tool execution lifecycle | Tool dispatch events | `tool.started`, `.updated`, `.completed` | `WorkItem (type: 'tool')` + `actions` | Tool invocation display card |
| User interaction request | Interaction handle | `interaction.requested`, `.resolved` | `WorkItem (type: 'interaction')` | Interactive prompt panel |
| Token telemetry & cost | Usage payload | `usage.updated` | `turn.usage` | Telemetry header/footer |
| Terminal lifecycle state | Settle event | `turn.completed`, `turn.failed` | `turn.status (status: 'terminal')` | Turn status seal & badge |

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 5.*

---

## 2. Three-level Work hierarchy & orthogonal FinalAnswer

### Current fact
- ADR-0008 and `tools/dashboard/server/ai/model/canonical-turn.mjs` establish the canonical three-level work hierarchy:
  - **Level 1 (Turn)**: Root execution unit for a user prompt, with immutable terminal outcomes (`completed`, `failed`, `cancelled`, `interrupted`).
  - **Level 2 (WorkItem)**: Ordered, strongly typed items (`commentary`, `reasoning`, `tool`, `interaction`) maintaining immutable sequence numbers (`seq >= 1`).
  - **Level 3 (ToolAction)**: Ordered sub-actions within a `tool` WorkItem representing compound operations (read, edit, execute) without inflating the top-level turn `activityCount`.
  - **FinalAnswer**: Kept on `CanonicalTurn.finalAnswer` (`FinalAnswer | null`), strictly orthogonal to Level 2 Work items.

### Proposed target
- Maintain strict orthogonality: commentary cannot morph into final answer merely because a turn finishes, and final answer content cannot be duplicated into a Level 2 commentary work item.
- When an adapter receives output text, it must route it based on the provider's active phase:
  - Text emitted during tool execution or before tool calls without final completion signals is commentary.
  - Authoritative conversational responses emitted as final completion are final answer text.

### Owner decision required
*Status: Established in ADR-0008; invariant preserved.*

---

## 3. Elimination of text heuristics

### Current fact
- In early prototypes, user questions or approvals were sometimes guessed by running regular expressions over the model's text stream.
- The current implementation requires structured interaction events, but fallback behavior when models emit plain text questions requires explicit policy.

### Proposed target
- **Zero Regex Parsing**: The UI and runtime must NEVER parse Markdown or free-form text using heuristics to detect tool calls, questions, approvals, or errors.
- **Evidenced Transitions**: A state transition to `requiresAttention` requires an explicit, structured `interaction.requested` event from the provider adapter.
- **Terminal Text Questions**: If a model ends a turn with a conversational question (e.g., *"Should I proceed with option A or B?"*), it is treated as normal `finalAnswer` text, ending the turn cleanly in `status: 'terminal' (outcome: 'completed')`. The user answers by typing in the composer, which starts a new Turn. It must NEVER fabricate an `interaction` WorkItem or hang in `requiresAttention`.

### Owner decision required
*Status: Awaiting owner approval on [owner-decisions.md](owner-decisions.md) § Decision 3.*

---

## 4. Authoritative tool closure

### Current fact
- `CanonicalTurn` validation requires that no tool invocation may remain in `active` or `queued` status once the owning Turn is terminal.

### Proposed target
- Tools that are still active or queued when a Turn reaches a terminal boundary must be authoritatively closed by the coordinator with `status: 'failed'` and an explicit `closureReason` (`turn_completed`, `turn_failed`, `turn_cancelled`, `turn_interrupted`, `process_exit`, `timeout`).
