---
id: ai-sessions-live-chat-integration.local-ai-registry-and-manual-attach
status: draft
change: ai-sessions-live-chat-integration
depends_on: [claude-readiness-discovery]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/local-session-registration.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - specs/active/ai-sessions-live-chat-integration/discovery/claude-readiness.md
    - .gitignore
    - tools/specs.mjs
    - tools/specs/service.mjs
    - tools/dashboard/server/index.mjs
  optional:
    - tools/tests/pull-request-metadata.test.mjs
    - tools/dashboard/tests/server.test.mjs
allowed_paths:
  - .gitignore
  - tools/ai/**
  - tools/specs.mjs
  - tools/specs/**
  - tools/tests/**
  - tools/dashboard/server/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
  - .claude/settings.local.json
semantic_references:
  decisions: [D2, D3, D6, D7]
  constraints: [C1, C2, C3, C4, C7, C14, C15, C16]
  dependency_contracts: [claude-readiness-discovery]
---

# Task: Local AI registry and manual attach

## Goal

Add ignored workstation configuration and a concurrent, idempotent spec-oriented session registry, then expose one deterministic manual attach service through CLI and dashboard API.

## Dependencies

Discovery must be READY (or completed required setup) so provider validation and config fields are grounded in the chosen transport.

## Implementation constraints

- Verify the Part 1 root ignore rule `/.nevo-ai-local/` before creating local data; retain it unchanged unless a failing containment test requires a targeted correction.
- Use `.nevo-ai-local/config.json` for enabled providers and non-secret discovery-approved settings.
- Store one atomic relation record per `(specId, provider, sessionId)` under `.nevo-ai-local/sessions/<specId>/...`; derive path-safe filenames and store original opaque IDs inside.
- Use atomic create/replace primitives so concurrent distinct registrations cannot overwrite one another and identical registrations converge idempotently.
- Validate spec identity, provider, task membership, record shape, and containment; reject a provider/session already owned by another spec unless a future explicit move operation is designed.
- Do not persist transcript, pending turn, raw provider payload, credential, or executable secret.
- Add `ai-session-attach` following existing kebab-case CLI command conventions, accepting a spec selector, provider, session ID, and optional comma-separated task IDs.
- Ask the adapter to validate discoverability when supported; an unavailable validation capability is explicit, not silently treated as proof.
- Route dashboard attach through the same service and `control` access policy; UI for attach-existing may remain a follow-up.

## Acceptance criteria

1. `.nevo-ai-local/` is ignored before any local config/registry files are produced. `automated: node --test tools/tests/ai-local-registry.test.mjs`
2. Config parsing accepts only allowed non-secret fields and reports missing/disabled provider state without affecting mock mode. `automated: node --test tools/tests/ai-local-registry.test.mjs`
3. Two parallel processes registering different sessions for one spec leave both readable; parallel identical registration leaves exactly one relation. `automated: node --test tools/tests/ai-local-registry.test.mjs`
4. Invalid spec/task/provider/session/path input cannot escape the local root or produce partial/corrupt records. `automated: node --test tools/tests/ai-local-registry.test.mjs`
5. Repeating manual attach is a no-op, and conflicting cross-spec ownership is rejected explicitly. `automated: node --test tools/tests/ai-session-attach.test.mjs`
6. CLI and dashboard API invoke the same registration service and provider validation behavior. `automated: node --test tools/tests/ai-session-attach.test.mjs; automated: npm --prefix tools/dashboard test`
7. Repository status contains no `.nevo-ai-local` paths after integration tests. `inspection: git status --short`

## Verification

```text
node --test tools/tests/ai-local-registry.test.mjs tools/tests/ai-session-attach.test.mjs
npm --prefix tools/dashboard test
node tools/specs.mjs check
```

## Documentation impact

Documentation is consolidated in task 14 after real provider behavior is verified.

## Out of scope

- Attach-existing frontend form, registry synchronization, detach/move workflow, transcripts, or credentials.
