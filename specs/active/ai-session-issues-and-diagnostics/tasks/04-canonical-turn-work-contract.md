---
id: ai-session-issues-and-diagnostics.canonical-turn-work-contract
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
    - specs/active/ai-session-issues-and-diagnostics/areas/canonical-turn-work-model.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-mappings.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/contracts.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/model/**
  - tools/dashboard/tests/ai-contracts.test.mjs
  - tools/dashboard/tests/ai-contract-drift.test.mjs
  - tools/dashboard/tests/fixtures/ai-neutral/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/**
  - tools/dashboard/server/ai/sessions/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D4, D5, D6, D7, D8, D9]
  constraints: [C1, C3, C4, C5, C6, C7, C8, C9, C11, C15]
  dependency_contracts: [claude-protocol-evidence, codex-protocol-evidence, antigravity-protocol-evidence]
---

# Task: Freeze the canonical Turn and ordered Work contract

## Goal

Using all three provider evidence sets, implement and document the one canonical contract for Turn
status, ordered Work, Commentary, Reasoning, ToolInvocation/ToolAction, Interaction, and
FinalAnswer. This is the only task that chooses exact neutral type/discriminant names.

## Requirements

- Implement validated provider-neutral types/normalizers matching the semantic aggregate and
  invariants in the area specification.
- Use a discriminated Turn status covering active work, passive waiting, required attention,
  cancelling, terminal outcome, and unknown/incomplete.
- Define stable Work identity/sequence and type-specific update rules.
- Keep ToolAction nested under one real ToolInvocation and separate provider-reported status from
  inferred closure reason.
- Preserve reasoning representation and commentary/final distinction without provider-specific
  public variants.
- Define a separate FinalAnswer lifecycle and prohibit commentary promotion.
- Define semantic kind/title/detail fields and mapping confidence/provenance needed by adapters and
  server projection without exposing provider-private IDs or raw payloads.
- Provide shared fixture builders and conformance assertions for downstream provider tasks.

## Acceptance criteria

1. Contract validators accept every evidenced Claude/Codex/Antigravity scenario and represent
   unavailable semantics as optional/unknown without provider-specific browser variants.
   `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
2. Ordering tests prove new Work items receive stable sequence while deltas/updates preserve item
   position. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
3. Compound-operation tests prove several ToolActions remain nested under one ToolInvocation and do
   not increase top-level activity count. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
4. Commentary, reasoning representations, transient waiting status, Interaction, and FinalAnswer
   are non-interchangeable validated concepts. `automated: node --test tools/dashboard/tests/ai-contracts.test.mjs`
5. Public serialization rejects provider-private IDs/raw payloads and contains no provider protocol
   unions. `automated: node --test tools/dashboard/tests/ai-contract-drift.test.mjs`
6. The contract includes no V1 compatibility requirement and no UI-derived command parsing.
   `inspection: contract review`

## Verification

```text
node --test tools/dashboard/tests/ai-contracts.test.mjs tools/dashboard/tests/ai-contract-drift.test.mjs
```
