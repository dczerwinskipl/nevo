---
id: ai-sessions-live-chat-integration.mock-ai-adapter-and-demo-data
status: draft
change: ai-sessions-live-chat-integration
depends_on: [provider-neutral-ai-contracts, interactive-turn-runtime]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/ai/contracts.mjs
    - tools/ai/turn-runtime.mjs
  optional:
    - tools/specs/service.mjs
allowed_paths:
  - tools/ai/**
  - tools/tests/mock-ai-adapter.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D3, D4, D5, D12]
  constraints: [C4, C5, C6, C7, C8, C9, C10, C11, C12, C13]
  dependency_contracts: [provider-neutral-ai-contracts, interactive-turn-runtime]
---

# Task: Mock AI adapter and demonstration data

## Goal

Implement a deterministic process-local `MockAiAdapter` that exercises the final provider/session/turn/interaction contract and supplies a useful dashboard demonstration without Claude.

## Dependencies

Depends on the shared contracts and turn runtime from tasks 02-03.

## Implementation constraints

- Keep all mock sessions/messages/turns in memory and reset them on process restart.
- Seed the designated active demonstration specification lazily or at startup using its real `specId` and tasks.
- For each task provide two non-completed sessions and two completed sessions with several messages; multi-task and spec-wide sessions may supplement but not replace the per-task cardinality.
- Use deterministic timestamps/content/order so tests and screenshots are stable.
- Stream multiple deltas rather than returning one completed string.
- Provide deterministic flows that request Allow/Deny and `AskUserQuestion`, then continue after the normalized response.
- Build each permission interaction's `input` as a bounded, display-safe, deterministic value for the mock tool kind it simulates (never an unconstrained/raw object) — the concrete proof that C9's "no raw provider payload, ever" rule is achievable by a real adapter, not just stated at the contract level.
- Do not build realistic autonomous planning, tool execution, or completed-session reactivation.

## Acceptance criteria

1. Every task in the demonstration fixture has exactly two seeded non-completed and two completed session associations. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`
2. Seeded and created sessions satisfy status/timestamp/task cardinality and sort rules. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`
3. Created sessions accept zero/multiple task IDs and produce deterministic provider/session identity without durable files. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`
4. A normal message streams several deltas and finishes; permission and question messages pause and continue through the shared runtime. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`
5. Completed sessions remain readable and reject unsupported reactivation with a normalized capability/status error. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`
6. A seeded/live permission interaction's `input` is a bounded, deterministic, display-safe value scoped to the simulated tool kind — never an arbitrary/unconstrained object. `automated: node --test tools/tests/mock-ai-adapter.test.mjs`

## Verification

```text
node --test tools/tests/mock-ai-adapter.test.mjs
node --test tools/tests/ai-contracts.test.mjs tools/tests/ai-turn-runtime.test.mjs
```

## Out of scope

- Claude files, `.nevo-ai-local/`, external processes, realistic tools, or persistence.
