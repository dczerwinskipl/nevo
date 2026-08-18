---
id: multi-provider-agent-sessions.agent-execution-modes-and-permissions
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/tasks/10-antigravity-adapter-and-events.md
    - specs/active/multi-provider-agent-sessions/tasks/11-multi-provider-consistency-audit-and-refinement.md
    - tools/ai/contracts.mjs
    - tools/ai/claude-adapter.mjs
    - tools/ai/antigravity-adapter.mjs
    - tools/ai/binding-service.mjs
allowed_paths:
  - tools/ai/**
  - tools/dashboard/server/**
  - tools/dashboard/src/**
  - tools/tests/**
  - tools/dashboard/tests/**
  - docs/decisions/**
  - docs/development/**
forbidden_paths:
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D7]
  constraints: [C1, C2, C3, C4, C5, C6, C7, C8, C9, C10]
---

# Task: Agent execution modes, permission policies, and unified questions

## Goal

Introduce provider-neutral execution modes (`ask`, `edit`, `agent`) with strict behavioral guarantees and explicit per-provider CLI mappings, preserve the verified `AskUserQuestion` interaction transport across all modes, establish `edit` as the safe default execution mode without implicit escalation to unrestricted autonomous execution, support invocation-scoped execution modes and permissions without mutating global settings, persist session mode preferences in local per-specification bindings, and provide dynamic mode selection in the dashboard.

## Requirements

1. **Provider-neutral execution modes (`AgentExecutionMode`):**
   - Define provider-neutral modes strictly by behavioral guarantees:
     - `ask`:
       - *Guarantee*: Analysis, code exploration, and guidance without source-file modification.
       - *Claude Code mapping*: `--permission-mode plan` (Claude dedicated planning mode).
       - *Antigravity mapping*: `--mode=plan` (invocation-scoped flag).
     - `edit` (Default):
       - *Guarantee*: Normal coding mode; workspace file edits proceed without repeated confirmation while provider safety policies remain active.
       - *Claude Code mapping*: `--permission-mode acceptEdits`.
       - *Antigravity mapping*: `--mode=accept-edits` (invocation-scoped flag).
     - `agent`:
       - *Guarantee*: Explicit unattended autonomous mode with provider permission bypass under Nevo's defined policy.
       - *Claude Code mapping*: `--permission-mode bypassPermissions`.
       - *Antigravity mapping*: `--mode=default --dangerously-skip-permissions` (invocation-scoped flags).
       - *Safety constraints*:
         - Fresh or default sessions must never silently escalate to `agent`.
         - `agent` is activated strictly when explicitly requested by user in turn/session parameters or restored from an explicitly persisted user preference.
         - `dontAsk` is explicitly rejected as an execution mode mapping because it denies permission-gated tools unconditionally and suppresses interactive questions.
   - Provider descriptors declare supported modes and default mode within their standard capability surface (`supportedModes: ['ask', 'edit', 'agent']`, `defaultMode: 'edit'`).

2. **Preserved verified Claude question transport:**
   - Maintain the established `AskUserQuestion` `PreToolUse/defer` roundtrip transport without introducing undocumented custom-tool definitions or speculative settings injections.
   - Emit unified `interaction.requested` (`kind: 'question'`) at the provider-neutral boundary.
   - In `plan`, `acceptEdits`, and `bypassPermissions` modes, verify that native interactive questions remain operational and correctly defer.

3. **Explicit invocation-scoped Antigravity mapping:**
   - Separate execution mode (`--mode <plan|accept-edits|default>`), permission policy (`--dangerously-skip-permissions` for `agent` mode), and subagent behavior.
   - All flags must be invocation-scoped CLI arguments passed to child processes; no global user settings files may be mutated.

4. **Session mode lifecycle, precedence, and persistence:**
   - Parameter `mode?: 'ask' | 'edit' | 'agent'` supported in `CreateSessionOptions` (`POST /api/agent-sessions`) and `StartTurnOptions` (`POST /api/agent-sessions/:provider/:sessionId/turns`).
   - Resolution precedence: `turn.mode` > `session.mode` > `provider.defaultMode` (resolving to `edit`).
   - Omitted turn and session mode always resolves to `edit`.
   - Persist last-used `mode` per session in `AgentSessionBindingService` (`.nevo-ai-local/sessions/<specId>.json`).
   - Session isolation: Changing execution mode in one session does not affect any other session.

5. **Dashboard integration:**
   - Mode selector in session creation modal (`tools/dashboard/src/components/ai-session-create-modal.tsx`), defaulting to `edit`.
   - Mode switcher in live chat header (`tools/dashboard/src/components/ai-chat.tsx`) enabling users to switch between Ask, Edit, and Agent modes.

## Verification

The test suite must verify both exact invocation mappings and provider behavioral guarantees:

1. **Validation**: Unsupported mode strings are rejected with `AiValidationError` at provider-neutral boundary.
2. **Default mode**: Provider descriptors advertise `defaultMode: 'edit'` and `supportedModes: ['ask', 'edit', 'agent']`.
3. **Default resolution**: Omitted session and turn mode strictly resolves to `edit` without escalating to `agent`.
4. **Autonomous escalation guard**: `agent` mode is passed to adapters only when explicitly selected in session/turn options or restored from an explicit binding record.
5. **Ask mode CLI mapping**: Claude spawns with `--permission-mode plan` and Antigravity spawns with `--mode=plan`.
6. **Ask mode behavioral guarantee**:
   - Deterministic adapter tests prove the exact plan mode invocation flags.
   - Offline provider fixture/transcript tests demonstrate that file-modification operations are prevented/omitted in `ask` mode without altering workspace files, ensuring the semantic guarantee cannot be claimed merely because a CLI flag string was passed.
7. **Edit mode CLI mapping**: Claude spawns with `--permission-mode acceptEdits` and Antigravity spawns with `--mode=accept-edits`.
8. **Agent mode CLI mapping**: Claude spawns with `--permission-mode bypassPermissions` and Antigravity spawns with `--mode=default --dangerously-skip-permissions`.
9. **Precedence**: Turn mode overrides session mode; session mode overrides provider default mode (`edit`).
10. **Persistence**: Session mode survives `AgentSessionBindingService` reload from disk per-spec file.
11. **Session isolation**: Updating mode for session A leaves session B unaffected.
12. **Question transport**: Claude question normalization continues using verified `AskUserQuestion` PreToolUse deferral across all modes.
13. **Neutral contract**: Claude and Antigravity expose the identical provider-neutral mode interface.

```bash
node --test tools/tests/agent-binding.test.mjs
node --test tools/tests/claude-adapter.test.mjs
node --test tools/tests/antigravity-adapter.test.mjs
node --test tools/tests/ai-contracts.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```
