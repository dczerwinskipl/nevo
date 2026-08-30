---
id: ai-session-issues-and-diagnostics.antigravity-neutral-mapping
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/provider-mappings.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/providers/antigravity/provider.mjs
    - tools/dashboard/tests/antigravity-provider.test.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/server/ai/providers/process-termination.mjs
  - tools/dashboard/tests/antigravity-provider.test.mjs
  - tools/dashboard/tests/fixtures/antigravity/**
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D3, D4, D5, D6, D7, D9, D10]
  constraints: [C1, C3, C4, C5, C6, C8, C9, C10, C11, C12, C13, C14, C15]
  dependency_contracts: [lifecycle-coordinator-and-timeouts]
---

# Task: Map Antigravity to the canonical model and fix timeout ownership

## Goal

Implement fixture-backed Antigravity semantic/lifecycle mapping, explicit print-timeout policy, and
separate terminal-result versus process-cleanup ownership.

## Requirements

- Implement every Antigravity rule in `areas/provider-mappings.md` against Task 03 fixtures.
- Track provider tool IDs independently, preserve all evidenced semantic fields, and represent
  unsupported/ambiguous phase/action data honestly.
- Report result/error/process/transport/cleanup evidence to the coordinator with a documented
  authority matrix.
- Pass `--print-timeout` explicitly according to neutral configuration; never rely on CLI default.
- Map provider timeout to structured timeout/provider failure without relabeling it user cancel.
- Retain optional raw capture with neutral Turn correlation and separate retention.
- Keep session aliases/provider IDs private and diagnose their resolution without exposing them to
  browser contracts.
- Remove Antigravity use of the transitional callback bridge when complete.

## Acceptance criteria

1. Fixture-to-canonical tests assert exact Work order, tool lifecycle/progress/timing, reasoning/text
   semantics, questions, terminal authority, and unknowns. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
2. Long tool execution remains active/waiting as evidenced and cannot be terminated by protocol
   silence merely because no text is emitted. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
3. Explicit print-timeout configuration and provider timeout classification are covered for the
   supported CLI behavior. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
4. Accepted result settles Turn independently of later process cleanup; cleanup barrier blocks unsafe
   reuse but never rewrites outcome. `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
5. Timeout-triggered cleanup cannot win as `cancelled`, and diagnostics identify the timeout owner.
   `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`
6. Public output excludes Antigravity aliases, private IDs, and raw payloads.
   `automated: node --test tools/dashboard/tests/antigravity-provider.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/antigravity-provider.test.mjs
```
