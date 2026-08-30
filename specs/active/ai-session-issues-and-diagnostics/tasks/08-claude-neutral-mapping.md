---
id: ai-session-issues-and-diagnostics.claude-neutral-mapping
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-mappings.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/claude/provider.mjs
    - tools/dashboard/tests/claude-provider.test.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/tests/claude-provider.test.mjs
  - tools/dashboard/tests/fixtures/claude/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4, D5, D6, D7, D9, D10]
  constraints: [C1, C3, C4, C5, C6, C8, C9, C10, C11, C14, C15]
  dependency_contracts: [lifecycle-coordinator-and-timeouts]
---

# Task: Map Claude to the canonical model

## Goal

Replace Claude's legacy callback mapping with fixture-backed canonical evidence for ordered Work,
Turn state, interactions, provider operation/process lifecycle, and terminal authority.

## Requirements

- Implement every Claude mapping rule in `areas/provider-mappings.md` against Task 01 fixtures.
- Track parallel tool IDs independently and retain real invocation boundaries.
- Normalize semantic kind/title/details below the UI boundary using explicit structured tool
  evidence; do not introduce browser or raw-command parsing.
- Preserve evidenced reasoning representation and text phase; use canonical unknown/derived behavior
  where the protocol does not prove a distinction.
- Report provider startup/activity/wait/terminal/process/cleanup evidence and safe diagnostic
  summaries.
- Preserve deferral/AskUserQuestion lifecycle and terminal precedence without inventing a final
  answer.
- Remove Claude use of the transitional callback bridge when complete.

## Acceptance criteria

1. Fixture-to-canonical tests assert exact Work order, tool identities/statuses, reasoning/text
   phases, interactions, timing, and terminal authority. `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`
2. Parallel tools remain independent ToolInvocations and content-block stop never completes them.
   `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`
3. Failed tool followed by recovery does not fail the Turn unless Claude supplies authoritative Turn
   failure. `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`
4. Cancellation, deferral, process exit, late events, and cleanup evidence follow coordinator
   precedence. `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`
5. Neutral/public output contains no Claude-private IDs or raw protocol payloads.
   `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/claude-provider.test.mjs
```
