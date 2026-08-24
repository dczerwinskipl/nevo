---
id: ux-improvements-version-1.antigravity-diagnostics-and-turn-lifecycle
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/ai-adapters.md
    - docs/development/ai-sessions.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - tools/ai/antigravity-adapter.mjs
    - tools/ai/process-termination.mjs
    - tools/dashboard/server/ai-services.mjs
    - tools/tests/antigravity-adapter.test.mjs
  optional:
    - tools/ai/turn-runtime.mjs
    - tools/ai/transcript-cache.mjs
semantic_references:
  decisions: [D4]
allowed_paths:
  - ai-adapters.yaml
  - tools/ai/antigravity-adapter.mjs
  - tools/dashboard/server/ai-adapters-config.mjs
  - tools/dashboard/server/ai-services.mjs
  - tools/dashboard/tests/ai-adapters-config.test.mjs
  - tools/tests/antigravity-adapter.test.mjs
  - docs/development/ai-sessions.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
---

# Task: Configure Antigravity diagnostics and harden terminal lifecycle

## Goal

Make Antigravity raw response diagnostics explicitly configurable while fixing the existing
error/lifecycle ambiguity that produces failed `run_command` tools with output `executed`, no
turn error, and repeated requests to continue.

## Implementation constraints

- Use the already installed `yaml` dependency and the repository's YAML helpers; add no
  dependency.
- Read `ai-adapters.yaml` from the repository root. Resolve the configured raw response
  directory relative to that root and reject paths that escape it.
- Preserve today's dashboard defaults: raw capture enabled and
  `.nevo-ai-local/antigravity_raw` as the directory.
- Keep provider-private raw payloads behind the adapter and out of browser/runtime contracts.
- Do not add neutral statuses, operation handles, polling, or a process-tree abstraction in
  this task.
- Reuse the existing bounded process termination helper.

## Acceptance criteria

1. `ai-adapters.yaml` can enable/disable Antigravity raw response capture and select its
   repository-relative output directory; absence of the file yields the current enabled/default
   directory behavior. `automated: node --test tools/dashboard/tests/ai-adapters-config.test.mjs`
2. Invalid configuration fails startup with a field-specific error; an absolute path or a
   relative path escaping the repository is rejected. `automated: node --test tools/dashboard/tests/ai-adapters-config.test.mjs`
3. With diagnostics disabled, no raw directory/file is created. With a custom directory,
   raw envelopes and `session.json` are written beneath the canonical provider session only;
   every turn-scoped envelope contains the canonical `providerSessionId` and Nevo `turnId`,
   with no cross-session mixing. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
4. An authoritative Antigravity error with an empty final response fails the turn even after
   streamed progress such as `Waiting for verification to complete`; the progress remains in
   the transcript and `turnError` is present. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
5. An active tool without an authoritative terminal tool result closes as `failed` with an
   explicit unknown-result diagnostic, never `executed`. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
6. Provider-error paths retain bounded ownership of the spawned process, and queued raw writes
   can be flushed during terminal/disposal boundaries without changing the public adapter
   contract. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
7. The AI-session development document explains the flag, directory setting, defaults, raw
   record session/turn correlation, and local-data sensitivity. `inspection: docs/development/ai-sessions.md matches the implemented configuration schema`

## Verification

```text
node --test tools/tests/antigravity-adapter.test.mjs tools/tests/ai-turn-runtime.test.mjs tools/dashboard/tests/ai-adapters-config.test.mjs tools/dashboard/tests/chat-projection.test.mjs tools/dashboard/tests/work-turn-correlation.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Out of scope

The cross-provider contract redesign described by the `ai-adapters-hardening` draft,
including detached/unknown statuses, provider operation handles, resumable polling, alias-store
redesign, and process-tree management.
