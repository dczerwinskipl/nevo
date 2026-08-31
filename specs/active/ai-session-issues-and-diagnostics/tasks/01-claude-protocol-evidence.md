---
id: ai-session-issues-and-diagnostics.claude-protocol-evidence
status: verified
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/claude/provider.mjs
    - tools/dashboard/tests/claude-provider.test.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
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
  decisions: [D3, D4, D5, D6, D9]
  constraints: [C1, C3, C4, C5, C6, C13]
---

# Task: Capture and audit Claude protocol semantics

## Goal

Produce sanitized, provenance-bearing Claude fixtures and a fixture-backed loss audit covering the
native semantics relevant to Turn, ordered Work, tools, reasoning, interactions, timestamps, and
terminal authority. Do not change the shared neutral contract in this task.

## Requirements

- Capture or regenerate real supported-CLI events for final answer, available mid-turn narration,
  thinking/reasoning, tool lifecycle, parallel tools, tool failure, AskUserQuestion, cancellation,
  provider failure, and authoritative completion/exit.
- Record CLI version, capture date, scenario, sanitization, and any protocol mode/settings required.
- Determine whether Claude exposes an authoritative commentary/final distinction. Mark absence or
  ambiguity explicitly; do not infer it in browser code.
- Audit tool name/input/title/description/progress/timestamps/durations and whether any structured
  sub-actions exist.
- Verify that `tool_use` and `tool_result` boundaries are preserved and that content-block stop is
  not execution completion.
- Document displayable reasoning representation versus provider-private/raw data.
- Extend fixture tests to fail on mapping-relevant protocol drift while keeping prompts, responses,
  paths, identities, and secrets sanitized.

## Acceptance criteria

1. Sanitized Claude fixtures include provenance and cover all evidenced required scenarios.
   `inspection: fixture provenance and sanitization review`
2. A provider audit matrix records native lifecycle, available semantics, current loss, mapping
   candidate, confidence, and exposure for every captured construct. `inspection: audit matrix review`
3. Tests prove operation identity/terminal authority, parallel tool correlation, reasoning shape,
   interaction shape, and any evidenced text phase. `automated: node --test tools/dashboard/tests/claude-provider.test.mjs`
4. Unsupported/ambiguous commentary, action, progress, or timing semantics are explicitly marked
   rather than fabricated. `inspection: fixture-to-audit comparison`
5. No fixture contains real prompt/answer content, credentials, user paths, or provider-private
   identity that is unnecessary for correlation testing. `inspection: sensitive-data review`

## Verification

```text
node --test tools/dashboard/tests/claude-provider.test.mjs
```
