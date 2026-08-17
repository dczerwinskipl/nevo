---
id: ai-sessions-live-chat-integration.part1-integration-verification-and-docs
status: draft
change: ai-sessions-live-chat-integration
depends_on:
  - stable-spec-identity-and-backfill
  - provider-neutral-ai-contracts
  - interactive-turn-runtime
  - mock-ai-adapter-and-demo-data
  - ai-session-http-and-sse-api
  - session-navigation-and-context-surfaces
  - fullscreen-chat-and-session-creation
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/solution-options.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - docs/development/local-setup.md
    - docs/development/architecture-overview.md
    - docs/decisions/ADR-0002-lightweight-markdown-workflow.md
    - .gitignore
  optional:
    - docs/development/testing-strategy.md
allowed_paths:
  - .gitignore
  - tools/tests/**
  - tools/dashboard/tests/**
  - docs/development/local-setup.md
  - docs/development/architecture-overview.md
  - docs/development/ai-sessions.md
  - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D6, D8, D9]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C15, C16, C17, C18, C19]
  dependency_contracts:
    - stable-spec-identity-and-backfill
    - provider-neutral-ai-contracts
    - interactive-turn-runtime
    - mock-ai-adapter-and-demo-data
    - ai-session-http-and-sse-api
    - session-navigation-and-context-surfaces
    - fullscreen-chat-and-session-creation
---

# Task: Part 1 integration verification and documentation

## Goal

Close the Part 1 delivery with cross-layer regression tests, complete mock vertical-slice evidence, current architecture/setup documentation, generated indexes, and the durable ADR required for independent review and PR delivery.

## Dependencies

Depends on every Part 1 implementation task. It is the explicit Part 1 checkpoint and Part 2 prerequisite.

## Implementation constraints

- Add only missing cross-layer/fixture tests and documentation; production fixes discovered here become targeted corrections in the owning prior task or blocking follow-ups.
- Verify the neutral contract as a whole rather than re-testing isolated internals only.
- Document trusted-network mode accurately: VPN is the current trust boundary, not identity authentication.
- Add `/.nevo-ai-local/` to the root ignore rules before Part 2 discovery can write local evidence.
- Record immutable spec identity, provider-owned history, neutral sessions/turns/interactions, SSE/HTTP direction, in-memory runtime, and local registry ownership in ADR-0007.
- Keep Claude installation and setup explicitly unnecessary for Part 1.
- Regenerate/check spec and docs indexes.

## Acceptance criteria

1. A clean checkout can run the dashboard with mock AI and complete list/create/open/message/permission/question/reconnect flows without Claude or local config. `inspection: recorded Part 1 desktop and phone walkthrough`
2. Cross-layer tests prove the browser/server contract event and field names cannot silently drift for required session/turn/interaction variants. `automated: npm --prefix tools/dashboard test`
3. Stable identity/backfill, mock runtime, dashboard regression, and production build checks all pass together. `automated: node --test tools/tests/*.test.mjs; automated: npm --prefix tools/dashboard test; automated: npm --prefix tools/dashboard run build`
4. Current architecture, dedicated AI sessions documentation, and local setup explain the mock mode, URLs, trusted-network warning, lifecycle limitations, and verification commands. `inspection: documentation matches the delivered runtime`
5. ADR-0007 records the durable decisions and rejected options without describing Claude-specific assumptions as facts. `inspection: ADR decision and consequences`
6. Generated specs/docs indexes are current. `automated: node tools/specs.mjs check; automated: node tools/docs.mjs check`
7. The root ignore rules exclude `/.nevo-ai-local/` before the Part 2 discovery checkpoint. `automated: git check-ignore .nevo-ai-local/probe`

## Verification

```text
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
git check-ignore .nevo-ai-local/probe
```

Run the Part 1 gating batch review and deep implementation review over task orders `01-08` before opening/merging the Part 1 PR.

## Documentation impact

Update local setup and architecture overview; add `docs/development/ai-sessions.md`, ADR-0007, and regenerate indexes.

## Out of scope

- Claude discovery/setup or real provider evidence.
- Fixing unrelated dashboard/workflow issues.
