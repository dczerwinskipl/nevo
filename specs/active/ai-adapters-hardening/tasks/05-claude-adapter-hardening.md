---
id: ai-adapters-hardening.claude-adapter-hardening
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/03-provider-model-catalog.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - specs/active/ai-adapters-hardening/areas/06-operation-process-lifecycle.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/claude/provider.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/tests/ai-provider-claude.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4, D6, D9]
  constraints: [C1, C2, C3, C4, C7, C9]
  dependency_contracts: [neutral-contracts-and-types, windows-process-tree-termination]
---

# Task: Harden Claude Code adapter with model catalog, process tree cleanup, and error mapping

## Goal

Harden `ClaudeAgentProvider` by supplying curated baseline model metadata and operator configuration, supporting turn-level model overrides with open permissive passthrough, integrating Windows-aware process tree termination, and mapping CLI errors into the normalized failure taxonomy.

## Requirements

- Provide curated model catalog entries for Claude models (e.g. Claude 3.7 Sonnet, Claude 3.5 Sonnet) with source `'known'` and merge with operator-configured models in `ai-providers.yaml` (`source: 'configured'`).
- Declare `canOverrideTurnModel: true`, `toolCalls: true`, and `reasoningEvents: true` in provider capabilities.
- Support turn-level and session-level model overrides: pass `--model <model>` to CLI on both new and resumed sessions, or omit when unspecified to preserve CLI defaults.
- Implement permissive passthrough: unlisted or custom model identifiers pass through to `--model` without local validation errors, logging a trace warning.
- Integrate the hardened `terminateChildProcess` from task 02 to guarantee full process tree cleanup on Windows during cancellation or timeout.
- Map Claude CLI failures (exit code 1, auth errors, rate limits, protocol issues) to normalized `AiError` taxonomy codes (`AI_AUTH_FAILED`, `AI_RATE_LIMITED`, `AI_PROVIDER_EXECUTION_ERROR`, etc.) with neutral recovery hints.
- Ensure the in-process Fastify MCP bridge (`ask_user`) continues to cleanly correlate questions with neutral `interaction.id` contracts.

## Acceptance criteria

1. Claude adapter exposes curated and configured models as `AgentModelDescriptor[]`. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`
2. Turn execution with specified model passes `--model` flag to `claude`; omitting it leaves provider defaults. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`
3. Permissive passthrough allows unlisted model strings to pass to `--model` without validation failure. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`
4. Turn cancellation invokes OS-aware process tree termination, ensuring nested tools are cleaned up. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`
5. CLI non-zero exit codes and error messages map to normalized failure codes and neutral recovery hints. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`
6. Fastify MCP interactions correlate cleanly with neutral interaction schemas. `automated: node --test tools/dashboard/tests/ai-provider-claude.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-provider-claude.test.mjs
```
