---
id: ai-adapters-hardening.event-normalization-pipeline
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/01-normalized-output-semantics.md
    - specs/active/ai-adapters-hardening/areas/02-interaction-ask-contract.md
    - specs/active/ai-adapters-hardening/areas/04-provider-capability-model.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/runtime/agent-turn-runtime.mjs
    - tools/dashboard/server/ai/sessions/turns/turn-event-stream.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/runtime/**
  - tools/dashboard/server/ai/sessions/turns/turn-event-stream.mjs
  - tools/dashboard/tests/ai-event-pipeline.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4, D5]
  constraints: [C1, C3, C5, C6]
  dependency_contracts: [neutral-contracts-and-types, codex-adapter-hardening, antigravity-adapter-hardening, claude-adapter-hardening]
---

# Task: Implement four-layer event pipeline, runtime evidence precedence, and output semantics

## Goal

Formalize the four-layer event transformation pipeline in `AgentTurnRuntime` and `TurnEventStream`, enforcing runtime evidence precedence over advisory catalog metadata, strict separation of commentary vs final answer, elimination of text heuristics, and composer fallback for terminal questions.

## Requirements

- Implement the four-layer pipeline (`Provider Protocol` -> `Internal Runtime Semantic` -> `Public AgentEvent` -> `CanonicalTurn Projection`).
- Enforce the runtime evidence precedence invariant: if a provider emits a valid normalized `reasoning.delta` event, the runtime accepts and projects it regardless of whether model catalog metadata marks reasoning as supported, unsupported, or unknown. Catalog metadata must never discard evidenced provider output.
- Enforce strict channel separation between `final_answer.delta` and `commentary.delta`:
  - Text emitted during tool execution or before tool calls without final completion signals is routed as commentary (`progress.delta`).
  - Authoritative conversational responses are routed as final answer (`text.delta` -> `turn.finalAnswer.text`).
  - Prohibit commentary promotion into final answer on turn completion.
- Eliminate all text/regex heuristics: never scan model output text to fabricate synthetic interactions or tool calls.
- Enforce composer fallback: conversational questions emitted by models at turn end settle cleanly as `status: 'terminal' (outcome: 'completed')` with `finalAnswer`, allowing the user to reply via the composer in a new turn.
- Enforce authoritative tool closure: any tools remaining active or queued when a turn reaches a terminal boundary are authoritatively closed with `status: 'failed'` and an explicit `closureReason`.

## Acceptance criteria

1. Four-layer pipeline transforms internal semantic events into public `AgentEvent` SSE stream without leaking internal or provider-specific envelopes. `automated: node --test tools/dashboard/tests/ai-event-pipeline.test.mjs`
2. Runtime evidence precedence ensures reasoning deltas from providers are accepted and projected even when model metadata is omitted or unknown. `automated: node --test tools/dashboard/tests/ai-event-pipeline.test.mjs`
3. Commentary and final answer deltas are preserved as distinct non-interchangeable channels; commentary is never promoted to final answer on completion. `automated: node --test tools/dashboard/tests/ai-event-pipeline.test.mjs`
4. Regex and text heuristic parsing are strictly prohibited; unevidenced text questions settle as `completed` with `finalAnswer` without fabricating interactions. `automated: node --test tools/dashboard/tests/ai-event-pipeline.test.mjs`
5. Active or queued tools are authoritatively closed with explicit `closureReason` when a turn terminates. `automated: node --test tools/dashboard/tests/ai-event-pipeline.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-event-pipeline.test.mjs
```
