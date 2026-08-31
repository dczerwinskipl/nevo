---
id: ai-session-issues-and-diagnostics.antigravity-protocol-evidence
status: verified
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-protocol-discovery.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/antigravity/provider.mjs
    - tools/dashboard/tests/antigravity-provider.test.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/tests/antigravity-provider.test.mjs
  - tools/dashboard/tests/fixtures/antigravity/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3, D4, D5, D6, D9, D10]
  constraints: [C1, C3, C4, C5, C6, C13, C14]
---

# Task: Capture and audit Antigravity protocol semantics

## Goal

Convert representative local Antigravity evidence into sanitized fixture-backed protocol knowledge,
including timeout and terminal authority, without changing the shared neutral contract in this task.

## Requirements

- Capture/sanitize supported CLI events for initialization/session identity, text, thought/reasoning,
  step/tool lifecycle and progress, questions, long-running tool work, provider error, cancellation,
  `result`/`done`, process close, and print timeout.
- Record CLI version, invocation flags, capture date, scenario, sanitization, and which event aliases
  are stable versus best-effort compatibility shapes.
- Establish whether text/step output exposes authoritative commentary/final phase information.
- Audit tool titles/descriptions/actions/progress/timestamps/durations and multi-tool correlation;
  explicitly record semantics the native protocol does not provide.
- Characterize `--print-timeout` disable/extend behavior for the supported CLI version and document
  the relationship between provider result and process cleanup.
- Retain raw capture only locally; commit only minimal sanitized fixtures.

## Acceptance criteria

1. Sanitized fixtures with provenance cover stable event envelopes, tools, reasoning/text,
   interaction, terminal error/success, process close, and provider timeout.
   `inspection: fixture provenance and sanitization review`
2. The audit matrix separates authoritative shapes from aliases and ties current normalization loss
   to real captured fields. `inspection: audit matrix review`
3. Tests characterize `--print-timeout`, result/process authority, long tool activity, and current
   timeout/cancel behavior. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
4. Missing commentary/final, action, progress, or multi-tool evidence is represented as unknown or
   unsupported, not guessed. `inspection: fixture-to-audit comparison`
5. Committed fixtures contain no real prompts, responses, credentials, user paths, or unnecessary
   provider/session identities. `inspection: sensitive-data review`

## Verification

```text
node --test tools/dashboard/tests/antigravity-provider.test.mjs
```
