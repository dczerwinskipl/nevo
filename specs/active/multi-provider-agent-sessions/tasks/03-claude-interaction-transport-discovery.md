---
id: multi-provider-agent-sessions.claude-interaction-transport-discovery
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/claude-provider.md
    - specs/active/multi-provider-agent-sessions/owner-decisions.md
    - specs/active/multi-provider-agent-sessions/tasks/01-provider-neutral-core-and-capabilities.md
allowed_paths:
  - specs/active/multi-provider-agent-sessions/areas/claude-provider.md
  - docs/development/ai-sessions.md
  - tools/tests/fixtures/claude/**
  - tools/tests/claude-deferral-discovery.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D4, D5]
  constraints: [C1, C4, C5]
---

# Task: Claude interaction transport discovery

## Goal

Perform targeted discovery of Claude Code's `PreToolUse/defer` mechanism, verify the minimum supported CLI version (>= 2.1.89), capture real fixtures for `AskUserQuestion` deferral, test the roundtrip resume flow, verify parallel tool batch boundaries, and evaluate native permission request mechanisms.

## Requirements

- Verify that installed `claude` CLI version satisfies minimum requirement for `PreToolUse` deferral (>= 2.1.89).
- Capture and persist real CLI fixture for `AskUserQuestion -> stop_reason: 'tool_deferred' -> deferred_tool_use`.
- Verify full roundtrip flow: `PreToolUse/defer -> process exit -> resume -> updatedInput -> execution continuation`.
- Verify and document behavior under parallel tool calls in a single batch as an explicit known limitation.
- Evaluate native permission prompt mechanisms (`--permission-prompt-tool`, `PreToolUse/defer`, `canUseTool`), select one approach preserving native permission semantics without building an artificial custom engine, and record the decision in `docs/development/ai-sessions.md`.
- Save representative fixture data under `tools/tests/fixtures/claude/` for downstream adapter unit tests.

## Verification

```bash
node --test tools/tests/claude-deferral-discovery.test.mjs
node tools/specs.mjs validate
```
