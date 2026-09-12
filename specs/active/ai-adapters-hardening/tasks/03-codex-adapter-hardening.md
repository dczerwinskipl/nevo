---
id: ai-adapters-hardening.codex-adapter-hardening
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/03-provider-model-catalog.md
    - specs/active/ai-adapters-hardening/areas/04-provider-capability-model.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/codex/provider.mjs
    - tools/dashboard/server/ai/providers/codex/app-server-client.mjs
    - tools/dashboard/server/ai/providers/process-termination.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/tests/codex-provider.test.mjs
  - tools/dashboard/tests/codex-app-server-client.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4, D6, D9]
  constraints: [C1, C2, C3, C4, C7, C9]
  dependency_contracts: [neutral-contracts-and-types, windows-process-tree-termination]
---

# Task: Harden OpenAI Codex adapter with native model discovery, turn overrides, and error mapping

## Goal

Harden `CodexAgentProvider` and `CodexAppServerClient` by implementing live model discovery via the native protocol v2 `model/list` JSON-RPC query, exposing turn-level and session-level model and effort overrides via `TurnStartParams`, adopting shared process-tree spawn options for the app-server daemon, and mapping app-server errors into the normalized 12-code failure taxonomy.

## Requirements

- Implement `listModels()` on `CodexAppServerClient` invoking the native `model/list` method; map the resulting models to normalized `AgentModelDescriptor[]` with source `'discovered'`, including authoritative per-model traits (`supportedReasoningEfforts`, `defaultReasoningEffort`, `inputModalities`).
- Declare `canOverrideTurnModel: true` in `CodexAgentProvider` capabilities.
- Support turn-level and session-level model and effort overrides: pass `model` and `effort` in `TurnStartParams` when specified, or omit them to preserve provider defaults.
- Implement permissive passthrough: unlisted or custom model identifiers specified by the caller are passed directly to `model/list` or `turn/start` without local rejection.
- Update `CodexAppServerClient` process spawn to adopt shared process tree spawn options (`detached: process.platform !== 'win32'`) from `process-termination.mjs`, ensuring the daemon and any child processes form an isolated process group on POSIX and are cleanly terminated via `terminateChildProcess()`.
- Map Codex JSON-RPC errors and failure notifications to normalized `AiError` codes (`AI_AUTH_FAILED`, `AI_RATE_LIMITED`, `AI_QUOTA_EXHAUSTED`, `AI_POLICY_DENIED`, `AI_PROTOCOL_ERROR`, `AI_PROVIDER_EXECUTION_ERROR`) with appropriate neutral `recoveryHint` values.
- Verify that native stdio JSON-RPC interaction requests (`item/tool/requestUserInput`, approvals) continue to correlate cleanly with neutral interaction IDs without exposing transport handles.

## Acceptance criteria

1. `CodexAppServerClient.listModels()` queries `model/list` over JSON-RPC and returns normalized `AgentModelDescriptor[]` with source `'discovered'`. `automated: node --test tools/dashboard/tests/codex-app-server-client.test.mjs`
2. `CodexAgentProvider` declares `canOverrideTurnModel: true`, `toolCalls: true`, and `reasoningEvents: true`. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
3. Turn execution with specified model or reasoning effort passes `model` and `effort` in `TurnStartParams`; omitting them preserves provider defaults. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
4. Unlisted model identifiers pass through permissively to the app-server without local validation errors. `automated: node --test tools/dashboard/tests/codex-app-server-client.test.mjs`
5. Codex error envelopes are mapped to discriminated `AiError` taxonomy codes and structured recovery hints using `AI_PROVIDER_EXECUTION_ERROR` for unhandled execution failures. `automated: node --test tools/dashboard/tests/codex-app-server-client.test.mjs`
6. Native JSON-RPC questions and approvals correlate cleanly with neutral `interaction.id` contracts. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
7. Codex app-server daemon process spawns with process-group isolation and terminates cleanly on disposal. `automated: node --test tools/dashboard/tests/codex-app-server-client.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/codex-provider.test.mjs tools/dashboard/tests/codex-app-server-client.test.mjs
```
