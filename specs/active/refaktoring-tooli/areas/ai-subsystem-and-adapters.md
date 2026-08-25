---
id: refaktoring-tooli.area.ai-subsystem-and-adapters
type: area
change: refaktoring-tooli
---

# Area: AI Subsystem and Adapters

## Responsibility

Owns the AI model and agent integration layer (`tools/ai/`), including provider adapters (`antigravity`, `codex`, `claude`, `mock`), child process execution lifecycle, single turn runtime orchestration (`turn-runtime.mjs`), session registry, and transcript caching.

## Current state

- `antigravity-adapter.mjs` (1039 LOC), `turn-runtime.mjs` (825 LOC), `codex-adapter.mjs` (771 LOC), `claude-adapter.mjs` (568 LOC), and `binding-service.mjs` (552 LOC) are monolithic modules.
- Protocol encoding/decoding, JSON streaming, process spawning via `spawn`, signal handling, and session state are conflated in individual files.
- Violates §3, §4, §7, §10, §11, and §12 of `node-tooling-guidelines.md`.

## Requirements

- Extract pure protocol parsing and message formatting (pure logic):
  - Parse event streams (SSE/JSONL) and translate them to unified contracts in `tools/ai/contracts.mjs`.
  - Encode input requests for each provider deterministically.
- Isolate child process execution with explicit lifecycle management:
  - Utilize async `spawn` or `execFile` with explicit `AbortSignal` cancellation and timeout handling.
  - Properly close child processes, detach listeners, and prevent double-completion bugs (`close` vs `error`).
- Structure modules within `tools/ai/`:
  - `tools/ai/adapters/` — provider-specific adapter implementations.
  - `tools/ai/protocol/` — pure protocol transformations.
  - `tools/ai/turn-runtime.mjs` — focused turn execution state machine.
  - `tools/ai/binding-service.mjs` — agent session context binding.
- Ensure structured error codes (`tools/ai/contracts.mjs`) without unhandled process exceptions.

## Interfaces and boundaries

AI adapters implement the shared provider contract defined in `tools/ai/contracts.mjs`. They are invoked by dashboard HTTP/SSE routes as well as CLI agent hooks.

## Area-specific acceptance criteria

1. No adapter file in `tools/ai/` exceeds ~300–400 LOC.
2. Provider protocol parsing is 100% unit-testable without spawning child processes.
3. Cancellation via `AbortSignal` reliably terminates child processes and cleans up system resources.
4. All tests in `tools/tests/ai/` pass cleanly.

## Out of scope

- Adding new AI providers or changing the public event contract schema.
