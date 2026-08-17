---
id: ai-sessions-live-chat-integration.claude-session-adapter
status: draft
change: ai-sessions-live-chat-integration
depends_on:
  - claude-readiness-discovery
  - local-ai-registry-and-manual-attach
  - claude-hooks-and-invocation-context
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/provider-neutral-ai-runtime.md
    - specs/active/ai-sessions-live-chat-integration/areas/claude-integration.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - specs/active/ai-sessions-live-chat-integration/discovery/claude-readiness.md
    - tools/dashboard/server/index.mjs
  optional:
    - tools/dashboard/server/providers/service.mjs
    - tools/dashboard/package.json
allowed_paths:
  - tools/ai/**
  - tools/tests/**
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - package.json
  - package-lock.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
  - .claude/settings.local.json
  - .nevo-ai-local/**
semantic_references:
  decisions: [D3, D4, D5, D6, D7]
  constraints: [C4, C5, C6, C7, C8, C9, C10, C11, C12, C14, C15, C16, C18, C19]
  dependency_contracts:
    - claude-readiness-discovery
    - local-ai-registry-and-manual-attach
    - claude-hooks-and-invocation-context
---

# Task: Real Claude session adapter

## Goal

Implement the discovery-selected Claude transport behind the Part 1 adapter contract, including real create/discovery/history/resume, live deltas, pending interactions, cancellation where supported, and automatic local relation registration.

## Dependencies

Requires READY discovery, local registry, and the proven hook/context strategy. Any discovery-required setup must be completed and reverified first.

## Implementation constraints

- Implement only the selected supported transport and canonical session ID semantics from the discovery report.
- If a new external package, API billing/key, or neutral-contract change is required but not already owner-approved, stop and record the decision instead of modifying package files.
- Keep Claude-specific executable/SDK types, raw events, request IDs, control responses, auth errors, and optional Remote Control metadata inside the adapter.
- Keep the provider operation alive across permission and `AskUserQuestion`; never model an unresolved interaction as prompt-process-exit-next-prompt.
- Map provider events into required normalized events and statuses; unsupported precision maps to `idle`.
- Load transcript/history through the official/provider-supported mechanism proven by discovery; do not parse private internal transcript formats as a shortcut.
- Register a newly created session relation only after a canonical provider session ID exists; registration failure is explicit and cannot silently orphan a dashboard session.
- Resume manually attached sessions when supported and expose accurate capabilities when not.
- Do not read/write real `.nevo-ai-local` data in unit tests; inject temporary roots and fake transport processes.

## Acceptance criteria

1. Adapter availability/config/auth diagnostics match the discovery-selected transport without exposing secrets. `automated: node --test tools/tests/claude-adapter.test.mjs`
2. Creating a session returns the real canonical session ID, registers its spec/task relation once, and streams normalized initial-turn events. `automated: node --test tools/tests/claude-adapter.test.mjs; inspection: real Claude session`
3. Provider-owned history is normalized and a later process can resume/send using the canonical ID. `automated: node --test tools/tests/claude-adapter.test.mjs; inspection: real close/reopen/resume`
4. Real permission and question requests remain on one live operation, resolve through neutral responses, and continue to completion. `automated: node --test tools/tests/claude-adapter.test.mjs; inspection: real interaction flow`
5. Raw provider request IDs/payloads never appear in public JSON/SSE, logs containing normal diagnostics, or registry records. `automated: node --test tools/tests/claude-adapter.test.mjs`
6. Cancellation, failure, disconnect, and backend shutdown map to truthful normalized states without deleting the durable provider session relation. `automated: node --test tools/tests/claude-adapter.test.mjs; automated: npm --prefix tools/dashboard test`
7. Mock provider and all Part 1 API tests remain unchanged/green. `automated: node --test tools/tests/*.test.mjs; automated: npm --prefix tools/dashboard test`

## Verification

```text
node --test tools/tests/claude-adapter.test.mjs
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

Run the discovery-defined real smoke checks for create, history, resume, permission, and question before task review.

## Out of scope

- Other providers, private transcript parsing, billing/model UI, durable provider process recovery, or frontend redesign.
