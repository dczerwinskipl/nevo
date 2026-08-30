# Area: Provider mappings

## Purpose

Translate real provider evidence into the canonical model without leaking provider vocabulary or
inventing unsupported semantics. Each provider mapping is an independent implementation/review unit
and must pass the same conformance suite.

## Shared adapter contract

Adapters emit neutral evidence for:

- provider operation requested/ready/activity/terminal/release;
- Turn status evidence (model production, tool execution, provider/tool wait, interaction wait);
- creation/update/terminal of Commentary, Reasoning, ToolInvocation, ToolAction, Interaction, and
  FinalAnswer;
- provider timestamps/durations with provenance;
- authoritative Turn completion/failure/interruption; and
- safe provider-specific diagnostic summaries.

Adapters never emit browser DTOs or write persistence. The coordinator validates IDs, ordering,
transition legality, and terminal precedence.

## Mapping confidence

Every semantic mapping is one of:

- **authoritative:** explicit provider field/state;
- **derived:** deterministic adapter interpretation of structured provider fields, documented and
  tested below the UI boundary; or
- **unknown:** insufficient evidence; omit the optional semantic value or expose canonical unknown.

Parsing raw shell text to claim file-read/search/list semantics is not an acceptable derived mapping.
Structured provider action data is acceptable.

## Claude mapping requirements

- One `tool_use` lifecycle remains one ToolInvocation; parallel IDs are tracked independently.
- Native tool name/input may map to semantic kind/title/action in the adapter using an explicit,
  fixture-tested table. Unknown tools remain semantic `other` with provider-derived title.
- `tool_result` is the invocation terminal authority; content-block stop is argument-stream
  completion only.
- Provider-presentable thinking/reasoning remains Reasoning and never commentary.
- Assistant text becomes Commentary or FinalAnswer only when fixture evidence/declared CLI contract
  supports the distinction. Any supported-version fallback is adapter-owned and confidence-marked.
- AskUserQuestion and any evidenced approval flow map to Interaction and drive attention.
- Process exit and result authority are declared explicitly. Deferral/restart metadata remains an
  adapter concern but reports neutral wait/interaction/operation evidence.
- Timestamps/durations are preserved when native; otherwise runtime-observed provenance is explicit.

## Codex mapping requirements

- `agentMessage.phase=commentary` becomes Commentary and `phase=final_answer` becomes FinalAnswer.
  Phase-less supported-version fallback remains adapter-local and tested, never browser logic.
- Reasoning summary and reasoning content retain their provider-defined representation instead of
  collapsing indistinguishably.
- Each native item (`commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`) keeps one
  ToolInvocation identity and lifecycle.
- `commandExecution.commandActions` maps to ordered ToolAction children using only variants proven
  by the captured app-server schema/events. Reads, searches, and listings receive semantic actions
  when the provider says so; no command-text parser is introduced.
- Semantic provider titles/descriptions/actions are primary. `command`, `cwd`, output, exit code,
  and raw tool input remain expandable details.
- `startedAtMs`, `completedAtMs`, `durationMs`, item status, and progress updates are retained with
  their correct scope.
- command/file/permission approvals and requestUserInput become Interaction; private request IDs stay
  in adapter correlation.
- `turn/completed` status remains authoritative. `thread/status/changed` and app-server connection
  facts report provider-operation/connection evidence without becoming chat Work.

## Antigravity mapping requirements

- Stable fixture-proven event shapes are mapped explicitly; best-effort aliases are isolated and
  identified in diagnostics rather than silently treated as equivalent authority.
- Thought/thinking maps to Reasoning. Text becomes Commentary or FinalAnswer only where protocol
  evidence supports the phase; otherwise use honest optional/unknown semantics from Task 04.
- Every provider tool ID is tracked independently. Name/input/output/status/progress/duration and any
  evidenced title/action semantics are preserved.
- Questions map to Interaction. Unsupported permissions do not appear as a false capability.
- `result`/`done`, error status, clean process close fallback, and process cleanup/release have an
  explicit authority matrix.
- `--print-timeout` is passed explicitly and aligned with neutral maximum-Turn policy. Provider
  timeout maps to a structured provider/timeout cause, not generic cancellation.
- Raw capture remains optional and linked to neutral trace correlation.

## Cross-provider equivalence

Equivalent provider facts map to equivalent concepts:

| Provider fact | Neutral concept |
|---|---|
| user-visible mid-turn narration | Commentary |
| displayable thinking/reasoning | Reasoning with representation |
| one native operation/item lifecycle | one ToolInvocation |
| structured actions inside one native operation | nested ToolAction[] |
| permission/question blocking continuation | pending Interaction + requiresAttention |
| no user input required, awaiting provider output | waiting/provider |
| provider executing or awaiting known tool | active/tool or waiting/toolResult as evidenced |
| provider-declared final phase | FinalAnswer |
| authoritative successful terminal | terminal/completed |
| provider/tool error followed by more work | failed invocation, non-terminal Turn |

Provider features need not be falsely equal. Unsupported fields stay optional/unknown and the UI
uses the shared fallback supplied by server projection.

## Conformance test shape

Each provider fixture test asserts:

- top-level Work type/order and stable identity;
- invocation count and nested action hierarchy/order;
- commentary/reasoning/final separation;
- interaction semantics and attention state;
- timestamps/durations/progress where evidenced;
- authoritative terminal mapping and late-event behavior;
- absence of provider-private fields in neutral/public JSON; and
- diagnostic summaries sufficient to explain dropped/unknown semantics.
