---
id: ai-adapters-hardening.conformance-and-cross-provider-validation
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/contracts.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/tests/cross-provider-conformance.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
  - docs/development/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12]
  dependency_contracts: [event-normalization-pipeline, operation-lifecycle-and-recovery]
---

# Task: Cross-provider conformance validation, contract drift tests, and architecture documentation

## Goal

Validate end-to-end conformance across Claude Code, OpenAI Codex, Google Antigravity, and Mock adapters through a unified conformance test suite, enforce contract drift guards, verify raw diagnostics isolation, and update architecture documentation to reflect the hardened adapter contracts.

## Requirements

- Expand the cross-provider conformance test suite in `tools/dashboard/tests/cross-provider-conformance.test.mjs` verifying:
  - Consistent terminal outcome arbitration across all adapters (`completed`, `failed`, `cancelled`, `interrupted`).
  - Permissive model passthrough behavior and model trait representation.
  - Consistent error taxonomy mapping and neutral recovery hints.
  - Interaction contract consistency (Codex native RPC, Claude Fastify MCP bridge, Antigravity per clarified D3 resolution).
  - Diagnostic isolation: assert that raw stdout/stderr lines, JSON-RPC envelopes, and private provider handles are never leaked to public SSE streams or HTTP API payloads.
- Update `tools/dashboard/tests/ai-contract-drift.test.mjs` to prevent regressions in provider descriptors, capability schemas, and model catalogs.
- Update architecture documentation in `docs/development/` to record the hardened AI adapter contracts, model catalogs, lifecycle models, and process tree termination guarantees.

## Acceptance criteria

1. Conformance suite passes across Claude, Codex, Antigravity, and Mock adapters, demonstrating identical contract semantics. `automated: node --test tools/dashboard/tests/cross-provider-conformance.test.mjs`
2. Contract drift suite verifies that all adapters conform to the updated `AgentProviderDescriptor`, `ProviderCapabilities`, and `AgentModelDescriptor` interfaces. `automated: node --test tools/dashboard/tests/ai-contract-drift.test.mjs`
3. Diagnostic privacy tests confirm that raw capture payloads and private provider IDs are never exposed over public SSE streams or HTTP endpoints. `automated: node --test tools/dashboard/tests/cross-provider-conformance.test.mjs`
4. Architecture documentation in `docs/development/` accurately reflects the four-layer event pipeline, model catalog discovery, error taxonomy, and process lifecycle. `inspection: documentation review`

## Verification

```text
node --test tools/dashboard/tests/cross-provider-conformance.test.mjs tools/dashboard/tests/ai-contract-drift.test.mjs
```
