---
id: ai-sessions-live-chat-integration.claude-hooks-and-invocation-context
status: draft
change: ai-sessions-live-chat-integration
depends_on: [ai-session-context-cli-preflight]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/local-session-registration.md
    - specs/active/ai-sessions-live-chat-integration/areas/claude-integration.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - specs/active/ai-sessions-live-chat-integration/discovery/claude-readiness.md
    - .claude/hooks/nevo-ai-spec-researcher-bash-guard.mjs
  optional:
    - .claude/settings.local.json
allowed_paths:
  - .claude/hooks/**
  - tools/ai/**
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - .claude/settings.local.json
semantic_references:
  decisions: [D6, D7]
  constraints: [C8, C14, C15, C16]
  dependency_contracts: [ai-session-context-cli-preflight]
---

# Task: Claude hooks and invocation context

## Goal

Implement the smallest discovery-proven Claude hook/context bridge that supplies provider plus canonical session ID to the shared CLI preflight, while preserving manual attach for unsupported surfaces.

## Dependencies

Depends on the generic preflight and a READY discovery report naming the supported hook/session context.

## Implementation constraints

- Implement only hook events/surfaces proven by discovery; do not invent a custom hook framework.
- Keep tracked hook helpers free of local executable paths, credentials, user identifiers, and provider transcript contents.
- Keep actual workstation hook enablement/settings local and ignored; never modify or commit `.claude/settings.local.json` in this task.
- Pass context per invocation/process. Do not write a shared current-session file.
- Validate provider ID and canonical session ID before exposing them to preflight.
- Multiple simultaneous Claude sessions must retain independent context.
- Unsupported VS Code/Remote Control surfaces fall back to manual attach or discovery-proven invocation wrapper and are documented as limitations.

## Acceptance criteria

1. The selected hook/context input maps the real canonical Claude session ID into a provider-neutral invocation context. `automated: node --test tools/tests/claude-invocation-context.test.mjs; inspection: discovery-proven real hook event`
2. Two concurrent hook fixtures and real sessions cannot read or overwrite one another's context. `automated: node --test tools/tests/claude-invocation-context.test.mjs; inspection: parallel runtime evidence`
3. Missing, malformed, or unsupported-surface hook input leaves spec commands operational and manual attach available. `automated: node --test tools/tests/claude-invocation-context.test.mjs`
4. Tracked diff contains no local path, credential, auth token, transcript, or `.claude/settings.local.json` content. `inspection: git diff and secret/path review`
5. Hook behavior matches the discovery matrix and does not claim universal automatic registration. `inspection: compare implementation to discovery report`

## Verification

```text
node --test tools/tests/claude-invocation-context.test.mjs
node --test tools/tests/ai-cli-preflight.test.mjs
node tools/specs.mjs check
```

Repeat the real two-session hook check documented by task 09 before review.

## Out of scope

- Hook support not proven by discovery, global current-session state, or editing user-local settings automatically.
