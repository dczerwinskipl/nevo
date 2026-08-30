# Area: Provider protocol discovery

## Purpose

Ground the canonical model in real Claude, Codex, and Antigravity protocol evidence. Each provider
gets an independently reviewable fixture and loss-audit task. The later contract task is the only
place that freezes shared neutral types.

## Fixture rules

Every provider fixture set must:

- originate from a supported real provider version or generated official schema, not a hand-written
  guess;
- record provider/CLI version, capture date, scenario, source mechanism, and sanitization notes;
- preserve event order, operation IDs within the fixture, timestamps/durations, phase/status fields,
  titles/descriptions, actions, interactions, and terminal signals relevant to mapping;
- replace prompts, response content, filesystem/user identities, credentials, and unrelated payload
  data with deterministic placeholders without changing event structure;
- include a small fixture reader/contract test so future protocol drift is visible; and
- label unsupported or ambiguous semantics explicitly rather than manufacturing values.

Raw captures remain local and optional. Only sanitized minimal fixtures are committed.

## Current confirmed loss audit

### Codex

Current baseline evidence on `feature/refaktoring-tooli` shows:

- native `agentMessage.phase` distinguishes `commentary` and `final_answer`; the adapter already
  maps these separately, but legacy phase inference still exists when the field is absent;
- native reasoning summary and reasoning text deltas are both reduced to one `reasoning.delta`
  stream, losing representation/source distinction;
- `commandExecution` includes `command`, `cwd`, `status`, output/exit/duration fields, and
  `commandActions`, but the adapter emits generic tool name `Command` and drops `commandActions`;
- provider `startedAtMs` and `completedAtMs` notification fields are not preserved in the neutral
  tool/message model;
- `fileChange`, `mcpToolCall`, and `dynamicToolCall` keep one provider item boundary but expose only
  a generic tool name/input/output contract;
- command/file/permission approval requests and tool user-input questions are normalized as
  interactions, while provider request correlation stays private;
- `thread/status/changed`, plan updates, server-request resolution, and provider-global connection
  notifications are ignored for semantic Turn state; and
- `turn/completed` is an explicit authoritative terminal signal and must remain the completion
  authority for the supported protocol version.

The Codex evidence task must inspect the generated app-server schema and representative events for
the exact `commandActions` variants. Expected semantic candidates include reads, searches, file
listing, writes/edits, command execution, and other provider-defined actions, but the committed
mapping may include only variants proven by the captured version.

### Claude

Current adapter evidence shows:

- `thinking` blocks/deltas map to reasoning;
- `tool_use` preserves provider tool ID, name, and input, and later `tool_result` owns completion;
- a tool content-block stop is correctly not treated as tool execution completion;
- native tool names/structured inputs commonly contain useful semantics, but the browser currently
  derives labels from names and fields such as paths, commands, patterns, and URLs;
- assistant text blocks currently all flow to the final-answer delta channel, so commentary/final
  phase meaning is not preserved or proven;
- the adapter has a single `activeTool` fallback even though fixtures cover parallel tool calls;
- AskUserQuestion deferral becomes a normalized question interaction; permission behavior depends
  on execution mode/hooks and must be documented from real evidence; and
- provider timestamps, tool titles/descriptions beyond name/input, progress, and process/completion
  evidence are not carried by the neutral chat model.

The Claude evidence task must establish which text/reasoning/tool/interaction phases are explicitly
available in the supported CLI protocol. If commentary versus final answer is not authoritative,
the mapping must say so and use the canonical unknown/compatibility behavior defined by Task 04;
the UI may not infer the distinction.

### Antigravity

Current adapter evidence shows:

- several event envelopes and aliases are accepted heuristically (`step_update`, `tool_use`,
  `call`, `tool_result`, `done`, and others);
- thought/thinking is mapped to reasoning, while text/content/step text is generally mapped to final
  text without a proven commentary/final phase boundary;
- tool ID/name/input/output/status and sometimes duration are preserved, but only one active-tool
  fallback is tracked and richer titles/actions/progress are not normalized;
- questions are normalized, interactive permissions are declared unsupported;
- authoritative `result`/`done`, clean process-close fallback, and post-result process cleanup have
  distinct meanings that the current neutral contract does not expose; and
- optional raw capture is the only existing detailed provider capture. Local evidence confirms the
  independent CLI `--print-timeout` default can terminate an otherwise active operation.

The Antigravity evidence task must turn representative raw events into sanitized fixtures and
separate stable supported shapes from best-effort aliases. Ambiguous fields remain provider details
or unknown neutral semantics rather than becoming browser heuristics.

## Required provider audit matrix

Each provider task produces the same matrix, with one row per native construct:

| Field | Meaning |
|---|---|
| Native construct | Exact event/method/item/field and supported provider version |
| Native lifecycle boundary | Start/update/terminal identity and correlation rules |
| Available semantics | Kind, title, description, actions, progress, phase, status, time, interaction |
| Current Nevo mapping | What the current adapter emits |
| Lost or distorted data | Fields/meaning discarded, merged, inferred, or mislabeled |
| Canonical mapping candidate | Target neutral concept, subject to Task 04 |
| Confidence | authoritative, derived below UI, or unknown/not evidenced |
| Exposure | browser-safe semantic data, expandable details, diagnostics-only, or dropped |

## Discovery completion gate

Task 04 may start only when all three provider audits:

- contain fixtures for the available representative scenarios;
- agree on real invocation identity and completion evidence;
- document whether commentary/final and reasoning representations are authoritative;
- document timestamps/durations and interaction semantics;
- document unknowns and unsupported states; and
- provide enough evidence to test compound invocation grouping and ordered Work.

If a provider cannot support a desired semantic distinction, Task 04 must encode an honest optional
or unknown representation. It must not add adapter-specific public variants or browser inference.
