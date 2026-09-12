---
id: ai-adapters-hardening.antigravity-adapter-hardening
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/02-interaction-ask-contract.md
    - specs/active/ai-adapters-hardening/areas/03-provider-model-catalog.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - specs/active/ai-adapters-hardening/areas/06-operation-process-lifecycle.md
    - specs/active/ai-adapters-hardening/areas/08-diagnostics-raw-capture.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/antigravity/provider.mjs
    - tools/dashboard/server/ai/providers/process-termination.mjs
    - tools/dashboard/server/ai/interactions/mcp/index.mjs
    - tools/dashboard/server/ai/interactions/mcp/interaction-registry.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/tests/antigravity-provider.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4, D6, D8, D9]
  constraints: [C1, C2, C3, C4, C6, C7, C9, C12]
  dependency_contracts: [neutral-contracts-and-types, windows-process-tree-termination]
---

# Task: Harden Google Antigravity adapter with dynamic discovery, durable MCP Ask, process cleanup, and alias persistence

## Goal

Harden `AntigravityAgentProvider` by implementing dynamic model discovery via `agy models` with 5-minute TTL caching, durable and idempotent MCP Ask registration (`agy mcp add nevo <url>`) declaring `interactiveQuestions: true`, supporting turn-level model and reasoning effort overrides (`--model`, `--effort`), integrating OS-aware process tree termination and spawn options, encapsulating session alias persistence with atomic writes, and mapping CLI errors into the normalized failure taxonomy.

## Requirements

- Implement dynamic model discovery querying `agy models` CLI command; parse output into normalized `AgentModelDescriptor[]` with `source: 'discovered'`. Ground traits strictly in observed per-model metadata; because `agy models` outputs only model ID and display label, leave `supportedReasoningEfforts` undefined (unknown) rather than manufacturing traits from the global `--effort` CLI option. Cache results for 300 seconds (5 minutes).
- Declare `canOverrideTurnModel: true`, `toolCalls: true`, `reasoningEvents: true`, and `interactiveQuestions: true` in provider capabilities.
- Support turn-level and session-level model overrides: pass `--model <model>` and optional `--effort <effort>` to `agy` command invocations, or omit when unspecified.
- Implement permissive passthrough: unlisted model strings pass to `--model` with trace warning without local validation rejection.
- Implement structured Ask capability (`interactiveQuestions: true`) via durable, idempotently managed `agy mcp` integration (Option 2 — approved by owner):
  - Server identity is deterministic: `nevo`.
  - Reuses the existing server-owned Fastify loopback MCP endpoint (`/mcp`) and `mcpInteractionRegistry`.
  - On adapter initialization and turn preparation, inspects existing `agy mcp list` registrations; if `nevo` is missing or points to an outdated URL, issues `agy mcp add nevo http://127.0.0.1:<port>/mcp`.
  - Strictly touches only the `nevo` entry; never modifies or deletes unrelated user MCP registrations.
  - Avoids fragile startup-add/shutdown-remove lifecycles that fail on ungraceful exits.
  - When `agy` model invokes the `ask_user` tool over the MCP bridge, correlates via `mcpInteractionRegistry` and projects the neutral `question` interaction schema.
  - Composer fallback remains for ordinary conversational questions emitted by models without calling `ask_user`.
  - Zero text heuristics.
- Harden `.nevo-ai-local/antigravity-sessions.json` alias persistence: retain adapter-internal ownership per owner decision D8, ensuring atomic disk writes via temporary file rename (`fs.rename`) to prevent corruption.
- Update child process spawn to adopt shared process tree spawn options (`detached: process.platform !== 'win32'`) from `process-termination.mjs`, and integrate `terminateChildProcess` to guarantee complete process tree cleanup across Windows and POSIX upon cancellation or timeout.
- Map Antigravity CLI errors and exit codes (e.g. exit code 124 for transport timeout) to normalized `AiError` taxonomy codes (`AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_EXECUTION_ERROR`, etc.) with appropriate neutral recovery hints.

## Acceptance criteria

1. Antigravity adapter executes `agy models` and parses output into `AgentModelDescriptor[]` with `supportedReasoningEfforts` left undefined (unknown), cached with a 5-minute TTL. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
2. Turn execution with specified model passes `--model` and `--effort` flags to `agy`; omitting them leaves CLI defaults in place. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
3. Permissive passthrough allows unlisted model identifiers to pass through to CLI without local validation errors. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
4. Antigravity adapter manages durable, idempotent `agy mcp add nevo <url>` registration without mutating unrelated user servers, and exposes `interactiveQuestions: true`. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
5. Structured Ask tool invocation (`ask_user`) via Antigravity MCP correlates through `mcpInteractionRegistry` and projects canonical `question` interaction schema. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
6. Session alias persistence (`antigravity-sessions.json`) operates atomically via temp file rename and survives simulated crash restarts. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
7. Turn cancellation invokes OS-aware process tree termination with process-group isolation, verifying child processes exit cleanly. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
8. CLI exit errors and transport timeouts map to normalized failure codes (`AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_EXECUTION_ERROR`, etc.) with neutral recovery hints. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/antigravity-provider.test.mjs
```
