---
id: ai-adapters-hardening.antigravity-adapter-hardening
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/03-provider-model-catalog.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - specs/active/ai-adapters-hardening/areas/06-operation-process-lifecycle.md
    - specs/active/ai-adapters-hardening/areas/08-diagnostics-raw-capture.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/antigravity/provider.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/tests/ai-provider-antigravity.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D3, D4, D6, D8, D9]
  constraints: [C1, C2, C3, C4, C6, C7, C9, C12]
  dependency_contracts: [neutral-contracts-and-types, windows-process-tree-termination]
---

# Task: Harden Google Antigravity adapter with dynamic discovery, process cleanup, and alias persistence

## Goal

Harden `AntigravityAgentProvider` by implementing dynamic model discovery via `agy models` with 5-minute TTL caching, supporting turn-level model and reasoning effort overrides (`--model`, `--effort`), integrating Windows-aware process tree termination, encapsulating session alias persistence with atomic writes, and mapping CLI errors into the normalized failure taxonomy.

## Requirements

- Implement dynamic model discovery querying `agy models` CLI command; parse output into normalized `AgentModelDescriptor[]` with `source: 'discovered'`; cache results for 300 seconds (5 minutes).
- Declare `canOverrideTurnModel: true`, `toolCalls: true`, and `reasoningEvents: true` in provider capabilities.
- Support turn-level and session-level model overrides: pass `--model <model>` and optional `--effort <effort>` to `agy` command invocations, or omit when unspecified.
- Implement permissive passthrough: unlisted model strings pass to `--model` with trace warning without local validation rejection.
- Maintain honest headless capability declaration: `interactiveQuestions: false` and `interactivePermissions: false`. Conversational questions at turn end settle cleanly with `finalAnswer` without fabricating synthetic interactions.
- Harden `.nevo-ai-local/antigravity-sessions.json` alias persistence: retain adapter-internal ownership per owner decision D8, ensuring atomic disk writes via temporary file rename (`fs.rename`) to prevent corruption.
- Integrate the hardened `terminateChildProcess` from task 02 to guarantee full process tree cleanup upon cancellation or timeout on Windows.
- Map Antigravity CLI errors and exit codes (e.g. exit code 124 for transport timeout) to normalized `AiError` taxonomy codes with appropriate neutral recovery hints.

## Acceptance criteria

1. Antigravity adapter executes `agy models` and parses output into `AgentModelDescriptor[]` cached with a 5-minute TTL. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`
2. Turn execution with specified model passes `--model` and `--effort` flags to `agy`; omitting them leaves CLI defaults in place. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`
3. Permissive passthrough allows unlisted model identifiers to pass through to CLI without local validation errors. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`
4. Session alias persistence (`antigravity-sessions.json`) operates atomically via temp file rename and survives simulated crash restarts. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`
5. Turn cancellation invokes OS-aware process tree termination, verifying child processes exit cleanly. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`
6. CLI exit errors and transport timeouts map to normalized failure codes (`AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_EXECUTION_ERROR`, etc.) with neutral recovery hints. `automated: node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-provider-antigravity.test.mjs
```
