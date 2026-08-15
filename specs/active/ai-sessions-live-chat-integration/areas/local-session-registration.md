# Local session registration

## Responsibility

Own ignored workstation configuration, stable spec/session relations, deterministic manual attach, and opportunistic invocation-scoped auto-registration without shared current-session state.

## Current state

There is no `.nevo-ai-local/` convention, registry, session attach command, or common spec-command preflight. Commander actions call handlers directly, some handlers are imported in tests, and `next` does not know its selected change until handler execution. The only existing Claude hook is a researcher guard, not a general session context bridge.

## Requirements

- Ignore `/.nevo-ai-local/` from Git.
- Define `config.json` for enabled providers and non-secret workstation settings; credentials remain in provider-supported auth/environment stores.
- Store atomic, path-safe, per-session relation records beneath a spec-oriented sessions directory.
- Preserve provider/session IDs inside records while deriving safe filenames; validate spec and task references.
- Make registration idempotent and safe when two processes register different or identical sessions concurrently.
- Expose one service to CLI, dashboard attach, auto-registration, and tests.
- Add deterministic manual attach using current CLI naming/handler testability conventions.
- Add common spec invocation preflight below Commander; explicit-spec commands register before their original logic, and `next` registers after selection.
- Treat absent/invalid invocation context as a no-op for the original command, with a diagnostic that never blocks normal workflow.
- Use discovery-selected Claude hooks only to deliver process-scoped context; manual attach remains the correctness fallback.

## Constraints

- Follow C1-C4, C7, C15-C16 and D2-D3, D6-D7.
- Never commit config, executable paths, credentials, session relations, or transcripts.
- Never use one global mutable current-session file.
- Do not add an extra mandatory register step to normal agent workflow.
- Do not let a provider hook change the semantic behavior or output of the wrapped spec command after successful preflight.

## Interfaces and boundaries

The local registry accepts resolved `specId`, provider, session ID, task IDs, source, and allowlisted metadata. Provider validation is an adapter capability. CLI parses selectors/options and calls the service; dashboard uses the same service. Invocation context is a process-scoped input, not persistent global state.

## Area-specific acceptance criteria

1. Two concurrent registrations for one spec leave both distinct relations readable.
2. Repeating the same `(specId, provider, sessionId)` registration creates no duplicate and preserves task IDs deterministically.
3. Manual attach accepts slug or stable selector, validates all task IDs, and optionally proves provider discoverability.
4. A valid context invocation associates the selected spec before its original command completes.
5. Missing context leaves every existing CLI command behavior and exit code unchanged.
6. A repository scan confirms `.nevo-ai-local/` data cannot be staged accidentally.

## Dependencies

Stable identity is required. Claude-specific invocation extraction waits for readiness discovery.

## Out of scope

- Registry synchronization between workstations.
- Transcript caching.
- General credential management or hook framework.
