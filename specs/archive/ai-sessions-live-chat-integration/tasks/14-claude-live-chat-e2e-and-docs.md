---
id: ai-sessions-live-chat-integration.claude-live-chat-e2e-and-docs
status: draft
change: ai-sessions-live-chat-integration
depends_on: [claude-session-adapter, fullscreen-chat-and-session-creation]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/claude-integration.md
    - specs/active/ai-sessions-live-chat-integration/areas/dashboard-session-experience.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - specs/active/ai-sessions-live-chat-integration/discovery/claude-readiness.md
    - docs/development/local-setup.md
    - docs/development/ai-sessions.md
  optional:
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
allowed_paths:
  - tools/tests/**
  - tools/dashboard/tests/**
  - docs/development/local-setup.md
  - docs/development/ai-sessions.md
  - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
  - specs/index.generated.json
  - specs/active/ai-sessions-live-chat-integration/discovery/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
  - .nevo-ai-local/**
  - .claude/settings.local.json
semantic_references:
  decisions: [D1, D3, D4, D5, D6, D7, D8, D9]
  constraints: [C4, C5, C6, C7, C8, C9, C10, C11, C12, C14, C15, C16, C17, C18, C19]
  dependency_contracts: [claude-session-adapter, fullscreen-chat-and-session-creation]
---

# Task: Claude live chat end-to-end verification and documentation

## Goal

Close Part 2 with real end-to-end evidence for dashboard-created and attached Claude sessions, concurrent registration, interactions, reconnect/reload/resume, current documentation, indexes, and the final independent review boundary.

## Dependencies

Depends on the real adapter and the unchanged Part 1 chat UX.

## Implementation constraints

- Use the owner's real local Claude environment and discovery-selected supported transport.
- Record sanitized IDs/output/screenshots or step evidence sufficient for review; never commit credentials, executable paths that are workstation-secret, transcript contents beyond minimal non-sensitive evidence, or `.nevo-ai-local` data.
- Verify both a dashboard-created session and an existing session attached manually.
- Distinguish SSE reconnect from backend restart: reconnect retains the turn; restart may interrupt it but later provider-session resume remains possible.
- Verify two simultaneous sessions and no relation overwrite.
- Update docs to describe only behavior actually proven by discovery/implementation, including limitations and manual fallback.
- Keep trusted VPN wording explicit and defer Google OIDC/allowlist/users/view-only roles to a follow-up specification.
- Production defects found here are fixed in their owning prior task or recorded as blocking follow-ups before review; do not hide them in documentation.

## Acceptance criteria

1. From the dashboard, the owner selects Claude, creates a spec/task-associated session, sends an initial prompt, receives a real canonical session ID, and sees incremental output. `inspection: recorded real end-to-end run`
2. Real Allow/Deny and `AskUserQuestion` pause the live operation, resolve through `turnId + interactionId`, and continue the same provider turn. `inspection: recorded interaction run`
3. Closing/reopening the phone/browser SSE connection preserves current turn/pending interaction; restarting the dashboard reports interruption without deleting the session relation. `inspection: reconnect and restart run`
4. After dashboard restart/reload, the same session is found from `.nevo-ai-local`, history is fetched from Claude, and a subsequent message resumes the provider session. `inspection: reload/history/resume run`
5. An existing real Claude session attaches manually, loads history, and resumes when the discovery capability says it should. `inspection: manual attach run`
6. Two concurrent real sessions register and remain independently addressable without overwrite. `inspection: concurrent session run`
7. Full tooling/dashboard/spec/docs tests and production build pass. `automated: node --test tools/tests/*.test.mjs; automated: npm --prefix tools/dashboard test; automated: npm --prefix tools/dashboard run build; automated: node tools/specs.mjs check; automated: node tools/docs.mjs check`
8. Local setup and AI architecture docs cover provider setup/auth/billing prerequisites, local file layout, hook/manual fallback, trusted VPN warning, lifecycle/restart limits, and verification troubleshooting. `inspection: docs versus runtime evidence`
9. Git diff/status contains no `.nevo-ai-local`, credential, raw provider payload, or user-local settings. `inspection: repository secret/local-data review`

## Verification

```text
node --test tools/tests/*.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs check
node tools/docs.mjs check
git diff --check
```

Run the discovery-defined real end-to-end matrix and retain sanitized evidence in `discovery/claude-readiness.md` or a linked Part 2 verification section. Then run the Part 2 gating review and deep implementation review over task orders `09-14` before opening/merging the Part 2 PR.

## Documentation impact

Update local setup, `docs/development/ai-sessions.md`, ADR consequences if discovery changed only provider-specific facts, and generated indexes.

## Out of scope

- Google OIDC/allowlist/roles, other providers, attachments, analytics, durable turns, advanced tools, automatic PRs, or multi-agent orchestration.
