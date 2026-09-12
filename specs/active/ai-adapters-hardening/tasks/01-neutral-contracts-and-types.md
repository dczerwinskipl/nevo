---
id: ai-adapters-hardening.neutral-contracts-and-types
status: draft
change: ai-adapters-hardening
context:
  required:
    - specs/active/ai-adapters-hardening/overview.md
    - specs/active/ai-adapters-hardening/owner-decisions.md
    - specs/active/ai-adapters-hardening/areas/03-provider-model-catalog.md
    - specs/active/ai-adapters-hardening/areas/04-provider-capability-model.md
    - specs/active/ai-adapters-hardening/areas/05-error-terminal-taxonomy.md
    - specs/active/ai-adapters-hardening/areas/07-availability-metadata.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/contracts.mjs
  optional:
    - specs/active/ai-adapters-hardening/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/model/**
  - tools/dashboard/tests/ai-contracts.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/server/ai/runtime/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D2, D4, D6, D10]
  constraints: [C1, C2, C3, C4, C7, C10]
---

# Task: Define normalized AI adapter contracts, model catalogs, and error taxonomy

## Goal

Implement the provider-neutral type definitions, schemas, normalizers, and validators for the enhanced AI adapter architecture in `contracts.mjs` and the `model/` domain, covering the normalized model catalog, decoupled capability and health models, and the 12-code error and recovery taxonomy.

## Requirements

- Define and export `AgentModelDescriptor` and `AgentModelTraits` schemas, supporting `id`, `label`, `isDefault`, `source` (`'discovered' | 'configured' | 'known'`), and advisory traits (`supportsReasoning`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `inputModalities`, `supportsVision`, `maxContextTokens`).
- Update `ProviderCapabilities` to include `canOverrideTurnModel`, `toolCalls` (authoritative flag), and `reasoningEvents`, separating transport capabilities from model-level traits.
- Update `AgentProviderDescriptor` to export `models: AgentModelDescriptor[]` and `health: ProviderHealth` (`enabled`, `installed`, `version`, `status`, optional `authenticated`, `unavailableReason`).
- Define the 12 normalized failure codes (`AI_AUTH_FAILED`, `AI_POLICY_DENIED`, `AI_RATE_LIMITED`, `AI_QUOTA_EXHAUSTED`, `AI_PROVIDER_UNAVAILABLE`, `AI_TRANSPORT_ERROR`, `AI_PROVIDER_TIMEOUT`, `AI_RUNTIME_TIMEOUT`, `AI_PROTOCOL_ERROR`, `AI_UNSUPPORTED_OPERATION`, `AI_OPERATION_LOST`, `AI_PROVIDER_EXECUTION_ERROR`) and `recoveryHint` values (`none`, `retry-after-delay`, `new-turn`, `new-session`, `operator-action`, `alternate-provider`).
- Implement permissive passthrough validation for model identifiers: unrecognized model strings emit advisory trace warnings without throwing validation errors.
- Ensure terminal outcomes (`completed`, `failed`, `cancelled`, `interrupted`) remain strictly decoupled from failure codes and recovery hints.

## Acceptance criteria

1. Contract validators accept `AgentModelDescriptor` with full trait metadata and validate sources (`discovered`, `configured`, `known`). `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
2. `ProviderCapabilities` includes `canOverrideTurnModel`, `toolCalls`, and `reasoningEvents`, cleanly separated from model traits. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
3. `ProviderHealth` validates decoupled configuration (`enabled`, `installed`, `version`) and operational health (`status: 'healthy' | 'degraded' | 'unavailable'`). `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
4. The 12 normalized error taxonomy codes and 6 recovery hints are exported, validated, and mapped with standard HTTP status codes. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
5. Contract drift tests verify that no provider-private identifiers or transport leakage exist in the neutral contract definitions. `automated: node --test tools/dashboard/tests/ai-contract-drift.test.mjs`
6. Permissive model passthrough normalizer accepts unlisted model identifiers without validation failure. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-contracts.test.mjs tools/dashboard/tests/ai-contract-drift.test.mjs
```
