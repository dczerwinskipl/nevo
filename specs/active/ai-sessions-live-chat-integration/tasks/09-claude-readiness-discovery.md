---
id: ai-sessions-live-chat-integration.claude-readiness-discovery
status: draft
change: ai-sessions-live-chat-integration
depends_on: [part1-integration-verification-and-docs]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/claude-integration.md
    - specs/active/ai-sessions-live-chat-integration/areas/local-session-registration.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - docs/development/local-setup.md
    - .gitignore
  optional:
    - .claude/commands/nevo-ai/task-start.md
    - tools/specs.mjs
allowed_paths:
  - specs/active/ai-sessions-live-chat-integration/discovery/**
  - .nevo-ai-local/**
forbidden_paths:
  - src/**
  - tests/**
  - tools/**
  - tools/dashboard/**
  - .claude/commands/**
  - .claude/hooks/**
semantic_references:
  decisions: [D1, D3, D4, D5, D6, D7]
  constraints: [C7, C8, C9, C10, C11, C12, C14, C15, C16, C19]
  dependency_contracts: [part1-integration-verification-and-docs]
---

# Task: Claude runtime discovery and readiness gate

## Goal

Run real, sanitized checks in the owner's environment; select and prove the smallest supported Claude integration path; and publish a readiness report whose result is READY, READY WITH REQUIRED SETUP, or BLOCKED.

This is an explicitly authorized **discovery/readiness task**, not implementation. The current task schema recognizes only `type: mechanical`, so this designation is behavioral rather than an invalid `type: discovery` front-matter value.

## Dependencies

Part 1 must pass its complete review boundary so discovery tests the actual neutral contract it may extend.

## Implementation constraints

- Run the real executable/environment rather than relying on documentation alone.
- Record commands, date/time, versions, resolved executable paths, sanitized outputs/exit codes, and reproducible session IDs/evidence without secrets.
- Compare Claude Code CLI/non-interactive CLI and Agent SDK for authentication, subscription versus API billing, streaming, session creation, resume, transcript/history reads, session IDs, hooks, interactions, and local backend use.
- Exercise sessions from CLI, VS Code, Remote Control when available, and the candidate programmatic transport.
- Prove which canonical ID finds history, resumes/sends, and relates to any Remote Control bridge ID.
- Test hooks for CLI/VS Code/Remote Control and two parallel sessions; distinguish supported automation from manual fallback.
- Test whether a live process can remain open across permission and `AskUserQuestion` and accept a control response.
- Prefer official/stable provider APIs; do not approve private transcript parsing merely because files exist.
- Raw/sensitive evidence remains under ignored `.nevo-ai-local/`; the committed report is sanitized.
- Confirm `/.nevo-ai-local/` is ignored before writing the first raw/local evidence file.
- If installation, login, API credential/billing, a new dependency, or owner choice is required, state it precisely and stop rather than guessing.

## Readiness outcomes

- **READY:** The selected transport is installed/authenticated and all required create/history/resume/live/interaction assumptions are proven.
- **READY WITH REQUIRED SETUP:** The transport is viable, setup steps are concrete, and those steps must be completed and rechecked before dependents start.
- **BLOCKED:** No supported path currently satisfies the required contract, evidence is contradictory, or an unresolved owner/security/billing/dependency decision remains.

A BLOCKED result leaves this task non-terminal with an execution suspension and therefore does not satisfy dependencies. READY WITH REQUIRED SETUP becomes dependency-satisfying only after setup evidence is appended and verified.

## Acceptance criteria

1. The report identifies installation, executable, version, authentication state/type, subscription/API billing consequences, and exact required setup. `inspection: sanitized runtime commands and outputs`
2. CLI and Agent SDK are compared against every required capability with evidence and one selected/rejected conclusion. `inspection: capability matrix and rejection reasons`
3. Canonical session ID, transcript lookup, resume/send, live events, and Remote Control identity behavior are exercised and documented. `inspection: real session evidence`
4. Permission and `AskUserQuestion` are tested for a live waiting process and provider control response; unsupported behavior yields BLOCKED rather than a fabricated design. `inspection: real interaction evidence`
5. Hooks are tested across available surfaces and two concurrent sessions, with an explicit automatic strategy and manual fallback. `inspection: hook/concurrency matrix`
6. The report lists required local config fields, limitations, raw-evidence location, and no committed credential/path/secret. `inspection: report and git diff`
7. The readiness result follows the definitions above and names every condition blocking later tasks. `inspection: readiness conclusion`
8. Raw evidence is written only after `git check-ignore .nevo-ai-local/probe` succeeds. `automated: git check-ignore .nevo-ai-local/probe`

## Verification

```text
node tools/specs.mjs validate
git diff --check
git check-ignore .nevo-ai-local/probe
```

Full task review must inspect the discovery report and runtime evidence. Automated schema checks alone cannot verify readiness.

## Documentation impact

Create `discovery/claude-readiness.md`. Product/setup documentation is updated only after implementation.

## Out of scope

- Implementing adapter, registry, hook, API, or UI changes.
- Installing/logging in or accepting billing/dependency changes without owner action.
