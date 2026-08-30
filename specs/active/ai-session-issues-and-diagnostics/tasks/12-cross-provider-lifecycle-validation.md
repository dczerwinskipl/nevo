---
id: ai-session-issues-and-diagnostics.cross-provider-lifecycle-validation
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-mappings.md
    - specs/active/ai-session-issues-and-diagnostics/areas/chat-migration-and-validation.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/tests/**
  - tools/dashboard/tests/fixtures/**
forbidden_paths:
  - tools/dashboard/server/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D3, D4, D5, D6, D7, D8, D9, D10, D11]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C14, C15, C16, C17]
  dependency_contracts: [claude-neutral-mapping, codex-neutral-mapping, antigravity-neutral-mapping, semantic-work-chat-v2]
---

# Task: Validate cross-provider lifecycle and Work UX

## Goal

Build the final provider-conformance and end-to-end validation corpus and prove the canonical model,
server projection, V2 UI, diagnostics, reload, and migration safety across Claude, Codex, and
Antigravity before cutover.

## Requirements

- Use sanitized provider fixtures and representative local sessions listed in the chat validation
  area.
- Assert equivalent provider facts produce equivalent neutral concepts while unsupported semantics
  remain optional/unknown.
- Exercise live event flow, SSE replay/reconnect, snapshot reload, server restart reconciliation,
  and V1/V2 view switching.
- Include long tool-heavy and compound-action Work, interleaved commentary, reasoning, interaction,
  tool failure/recovery, long execution, waits, cancellation, timeout, provider failure, final
  answer, cleanup barrier, and unknown/interrupted recovery.
- Add desktop/mobile inspection fixtures or test harness coverage for long Work timelines.
- This task adds validation only. A failing production behavior is corrected in/reopened against the
  owning implementation task or recorded as a blocking follow-up; validation does not broaden into
  an unscoped production rewrite.

## Acceptance criteria

1. One shared conformance suite runs the equivalent semantic scenarios for all three providers.
   `automated: npm --prefix tools/dashboard test`
2. Exact Work order, one-invocation/many-actions hierarchy, status/current activity, interactions,
   and FinalAnswer survive live/replay/reload. `automated: npm --prefix tools/dashboard test`
3. Waiting provider/tool and requires-attention remain distinct across all supported provider
   evidence. `automated: npm --prefix tools/dashboard test`
4. Cancellation, timeout, provider failure, cleanup, and interruption/unknown each retain correct
   owner/cause and diagnostic reconstruction. `automated: npm --prefix tools/dashboard test`
5. Tool-heavy desktop/mobile V2 is understandable in collapsed and expanded forms, with only
   current/relevant items strongly emphasized. `inspection: representative desktop/mobile session review`
6. The same active session remains usable through V1 if V2 projection/rendering is intentionally
   faulted in the validation harness. `automated: npm --prefix tools/dashboard test`
7. Dashboard test suite and production build pass. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```
