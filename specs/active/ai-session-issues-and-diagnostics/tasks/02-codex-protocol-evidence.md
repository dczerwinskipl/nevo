---
id: ai-session-issues-and-diagnostics.codex-protocol-evidence
status: verified
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/codex/protocol-baseline.json
    - tools/dashboard/server/ai/providers/codex/provider.mjs
    - tools/dashboard/tests/codex-provider.test.mjs
  optional:
    - tools/dashboard/server/ai/providers/codex/verify-schema.mjs
allowed_paths:
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/tests/codex-provider.test.mjs
  - tools/dashboard/tests/codex-schema-compat.test.mjs
  - tools/dashboard/tests/codex-app-server-client.test.mjs
  - tools/dashboard/tests/fixtures/codex-app-server/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4, D5, D6, D9]
  constraints: [C1, C3, C4, C5, C6, C13]
---

# Task: Capture and audit Codex protocol semantics

## Goal

Use the supported Codex app-server schema and real sanitized events to document all mapping-relevant
semantics, especially `commandExecution.commandActions`, without changing the shared neutral
contract in this task.

## Requirements

- Generate/inspect the exact supported app-server schema and update the compact baseline to cover
  mapping-critical item/action fields, not only method names.
- Capture sanitized events for commentary, final answer, reasoning summary/content, command
  execution with multiple commandActions, file change, MCP/dynamic tool, tool progress/failure,
  approvals, user-input questions, token usage, thread status, cancellation, provider failure, and
  authoritative Turn completion.
- Enumerate exact `commandActions` variants and fields. Identify which prove read, search, list,
  write/edit, execute, fetch, or other semantics. Do not parse command text to fill gaps.
- Preserve evidence for one commandExecution lifecycle containing several semantic actions.
- Audit provider titles/descriptions, started/completed timestamps, duration, statuses, progress,
  interaction blocking, reasoning representations, message phase, connection state, and terminal
  status.
- Record what current `toolDescription`, reasoning mapping, notification filtering, and timestamp
  handling discard or distort.

## Acceptance criteria

1. The schema baseline and sanitized fixtures identify exact supported `commandActions` variants
   and mapping-relevant fields with provider version provenance. `automated: node --test tools/dashboard/tests/codex-schema-compat.test.mjs`
2. A fixture proves one `commandExecution` with several actions retains one provider item/operation
   identity and one terminal result. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
3. The audit matrix covers commentary/final phase, distinct reasoning representations, all supported
   tool item types, actions, interactions, timestamps/durations, connection facts, and completion
   authority. `inspection: audit matrix review`
4. Current losses, including generic `Command`, discarded commandActions, ignored timestamps/status
   notifications, and merged reasoning streams, are tied to concrete fixture/schema fields.
   `inspection: fixture-to-adapter comparison`
5. No semantic action is inferred from raw shell command syntax. `inspection: fixture and test review`

## Verification

```text
node --test tools/dashboard/tests/codex-schema-compat.test.mjs tools/dashboard/tests/codex-provider.test.mjs tools/dashboard/tests/codex-app-server-client.test.mjs
```
