# Area: AI adapters

## Problem

Antigravity raw protocol capture is hardcoded by the dashboard factory instead of being an
operator-visible adapter setting. At the same time, an authoritative provider error with an
empty final response can be normalized as a successful turn whenever earlier progress text
exists. An active `run_command` is then closed as failed with the misleading output
`executed`, leaving the UI without a turn error and encouraging repeated manual continuation.

The adapter already records raw stdout/stderr before semantic processing and associates raw
envelopes with provider session and turn IDs, but shutdown/terminal paths do not consistently
await queued diagnostic writes and not every failure path owns termination of the spawned
process.

## Scope

- `ai-adapters.yaml` at the repository root is the operator-visible adapter configuration.
- Antigravity raw response capture has an enabled flag and a configurable repository-relative
  directory.
- Existing default behavior remains compatible when configuration is absent or uses the
  committed defaults.
- Authoritative provider errors with no final response fail the turn even if progress text was
  emitted earlier; that progress remains available in the transcript.
- A tool with no authoritative terminal result is reported as failed with an explicit
  diagnostic message, never `executed`.
- Raw records remain partitioned by canonical provider session and correlated to the Nevo
  turn; queued writes are flushed on bounded lifecycle boundaries.
- Provider-error paths retain ownership of the spawned Antigravity process and terminate it
  with the existing bounded termination policy.

## Out of scope

- New provider-neutral tool statuses such as `unknown` or `detached`.
- Exposing provider operation handles or implementing polling/resume.
- Redesigning the alias store or moving provider-owned conversation history into Nevo.
- Applying this configuration model to every provider in the same task.
