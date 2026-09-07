---
id: ai-session-issues-and-diagnostics.codex-neutral-mapping
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-mappings.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/codex/provider.mjs
    - tools/dashboard/server/ai/providers/codex/protocol-baseline.json
    - tools/dashboard/tests/codex-provider.test.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
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
  decisions: [D3, D4, D5, D6, D7, D9, D10]
  constraints: [C1, C3, C4, C5, C6, C8, C9, C10, C11, C14, C15]
  dependency_contracts: [lifecycle-coordinator-and-timeouts]
---

# Task: Map Codex to the canonical model

## Goal

Preserve Codex's native semantic richness, especially commandActions and message phases, while
keeping each provider item as one real invocation and reporting app-server lifecycle evidence.

## Requirements

- Implement every Codex mapping rule in `areas/provider-mappings.md` against Task 02 schema/fixtures.
- Map `commentary` and `final_answer` explicitly and retain distinct reasoning summary/content
  representations.
- Map each commandExecution to one ToolInvocation and its structured commandActions to ordered nested
  ToolActions. Never create one invocation per action.
- Use provider semantic fields for title/kind/action; retain command/cwd/output/exit/details as
  secondary technical data.
- Preserve start/completion timestamps, duration, progress/status, approval/question interactions,
  thread/connection evidence, and `turn/completed` authority.
- Keep private item/request/thread correlation below public serialization.
- Remove Codex use of the transitional callback bridge when complete.

## Acceptance criteria

1. A compound command fixture produces one ToolInvocation with exact ordered semantic actions and
   one lifecycle/result. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
2. Commentary, final answer, reasoning summary/content, interactions, timing, and terminal status map
   exactly from captured fields. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
3. Equivalent file/MCP/dynamic tools retain provider operation boundaries and semantic server-safe
   titles/details. `automated: node --test tools/dashboard/tests/codex-provider.test.mjs`
4. No production UI/server projection code needs Codex identity, commandActions variants, phase
   fields, or command parsing. `inspection: dependency search`
5. Cancellation, app-server connection failure, authoritative completion, and late events follow
   coordinator precedence and are diagnostically distinguishable.
   `automated: node --test tools/dashboard/tests/codex-provider.test.mjs tools/dashboard/tests/codex-app-server-client.test.mjs`
6. Generated-schema compatibility tests protect every mapping-critical field/variant.
   `automated: node --test tools/dashboard/tests/codex-schema-compat.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/codex-schema-compat.test.mjs tools/dashboard/tests/codex-provider.test.mjs tools/dashboard/tests/codex-app-server-client.test.mjs
```
