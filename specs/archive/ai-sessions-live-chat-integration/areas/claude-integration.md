# Claude integration

## Responsibility

Prove and implement the smallest supported local Claude transport behind the Part 1 provider-neutral contract, including real history, resume, streaming, interactions, hooks, and end-to-end evidence.

## Current state

The repository has no Claude provider adapter and no verified facts about the owner's installed executable, authentication, subscription/API billing, programmatic transport, canonical session IDs, transcript APIs, resume semantics, Remote Control identifiers, or hook behavior across CLI and VS Code. Those facts are temporally and environment dependent.

## Requirements

- Run a discovery/readiness gate in the owner's actual environment before implementation.
- Compare Claude Code CLI/non-interactive CLI and Agent SDK for authentication, billing, streaming, session creation, canonical IDs, history, resume/send, hooks, and dashboard backend use.
- Exercise real sessions created from CLI, VS Code, Remote Control when available, and the candidate programmatic transport.
- Prove which ID finds history, resumes, accepts another prompt, and correlates any Remote Control bridge metadata.
- Test hooks in real surfaces and with two simultaneous sessions; identify opportunistic automation and manual fallback.
- Record exact required install/login/config steps and sanitized evidence.
- Implement only the selected supported transport after READY or completed required setup.
- Keep a live Claude operation active across permission and `AskUserQuestion`, mapping control responses inside the adapter.
- Create/resume sessions, read provider-owned history, stream normalized events, and persist only the local relation.
- Verify a dashboard-created and a manually attached session behave consistently.

## Constraints

- Follow C7-C16, C18-C19 and D3-D7.
- Discovery is a behaviorally explicit discovery/readiness task because the current validator recognizes only `type: mechanical`; it must not pretend provider assumptions are implementation facts.
- A BLOCKED result leaves the task non-terminal/suspended and prevents all dependents.
- A new package, API key/billing requirement, unsupported private transcript parsing, or neutral-contract change requires owner review before proceeding.
- Do not freeze raw Claude CLI wire protocol unless discovery proves it supported and stable enough for the chosen use.
- Prefer official/provider-supported history/session APIs over parsing internal transcript files.

## Interfaces and boundaries

`ClaudeAdapter` implements the shared provider contract and privately owns transport processes/callbacks, provider IDs, raw events, auth discovery, and control responses. The local config supplies non-secret executable/transport settings. Browser, registry, and generic turn runtime remain Claude-agnostic.

## Area-specific acceptance criteria

1. The discovery report can independently justify READY, READY WITH REQUIRED SETUP, or BLOCKED from runtime evidence.
2. Canonical session ID, history, resume/send, streaming, interaction control, hooks, and limitations are proven rather than inferred.
3. A real dashboard-created session survives dashboard reload through registry lookup and provider-owned history.
4. A real existing session attaches manually, loads history, and resumes when supported.
5. Real permission and question interactions continue the same turn/process.
6. Two simultaneous sessions register without overwriting one another.

## Dependencies

Part 1 must pass its review boundary. Discovery is the first Part 2 task and blocks all provider-specific implementation.

## Out of scope

- Other real providers, Claude billing UI, model switching, private transcript reverse engineering, Remote Control UI, or durable Claude process recovery.
