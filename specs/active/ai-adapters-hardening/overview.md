---
id: spec.ai-adapters-hardening
type: change
title: "AI adapters hardening"
status: draft
change: ai-adapters-hardening
---

# AI adapters hardening

## Status

Refined Architectural Specification with Approved Owner Decisions (D1–D10) and Task Decomposition.

## Goal

Harden NEvo's AI adapter contracts, error handling, process lifecycles, and model catalog across Claude Code, OpenAI Codex, and Google Antigravity, such that provider-specific transport/protocol quirks remain strictly inside adapters while the rest of NEvo can rely on deterministic, consistent semantics.

The resulting contract provides the hardened foundation for later orchestration work (provider/model selection, automated retry/fallback, agent handover, quota handling), while keeping those orchestration features themselves strictly out of scope.

## Problem

Following the implementation of the canonical Turn and Work model (ADR-0008), deep repository discovery and protocol verification revealed several critical architectural and transport disparities across provider adapters:

1. **Error taxonomy collapse**: Materially different failures (invalid authentication, quota exhaustion, token rate limits, upstream outages, CLI exit 1, and process crashes) currently collapse into generic `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502). Downstream retry or fallback orchestration cannot make deterministic recovery decisions without parsing brittle provider error strings.
2. **Missing model catalog & discovery**: Provider descriptors contain zero model metadata. While `agy` natively supports dynamic discovery (`agy models`), Codex app-server v2 natively supports `model/list`, and Claude accepts `--model`, Nevo has no normalized model catalog schema, no distinction between discovered vs configured vs known models, and no model override propagation.
3. **Session identity asymmetry & alias persistence**: Claude accepts client-assigned UUIDs, Codex generates authoritative thread IDs on a persistent daemon, and Antigravity allocates internal IDs during headless streaming. Antigravity manages a local `.nevo-ai-local/antigravity-sessions.json` alias store, which works reliably across restarts but requires formalized adapter encapsulation and atomic writes.
4. **Windows process tree leaks**: Claude and Antigravity spawn CLI child processes that often run nested commands (bash, git, compilers, tests). On Windows, `process-termination.mjs` relies on `child.kill()`, which terminates only the root PID and leaves orphaned grandchild subprocesses running.
5. **Conflated availability and enablement**: The current boolean pair (`enabled`, `available`) conflates operator configuration (allow-list in `ai-providers.yaml`), binary installation, authentication state, and transient rate limits into a single `available` boolean.

## Document map

- [discovery.md](discovery.md): Comprehensive repository discovery report and 26-dimension provider comparison matrix across Claude, Codex, and Antigravity.
- [owner-decisions.md](owner-decisions.md): Formally approved owner architectural decisions (D1–D10):
  1. Provider Model Catalog Strategy (Discovered vs Configured vs Known vs Provider Default; Permissive passthrough)
  2. Model Selection Scope (Session persistence; Capability-driven turn switching via `canOverrideTurnModel`)
  3. Interaction Contract & Headless Adapter Policy (Neutral contract; Codex stdio RPC, Claude MCP bridge, Antigravity headless with composer fallback; no text heuristics)
  4. Capability Ownership & Decoupling (Transport Capabilities vs Model Traits; Runtime evidence precedence)
  5. Public vs Internal Event Vocabulary & Output Semantics (4-layer transformation pipeline)
  6. Error & Failure Taxonomy vs Terminal Outcomes (Decoupled terminal outcomes, 12 normalized codes, structured recovery hints)
  7. Lost / Unknown Operation Semantics (Epistemic truth; `status: 'unknown'`; reconciliation via authoritative evidence; forced cleanup settles as `interrupted`)
  8. Antigravity Session Identity & Alias Store (Preserved and encapsulated within Antigravity adapter boundary with atomic writes)
  9. Child Process Lifecycle & Windows Process Tree Termination (OS-aware process tree termination)
  10. Provider Availability vs Health Metadata Decoupling (Stable configuration facts vs transient health; per-turn rate-limit isolation)
- **Area specifications**:
  - [Area 1: Normalized output semantics](areas/01-normalized-output-semantics.md): Four-layer event transformation pipeline, canonical three-level Work hierarchy, orthogonal FinalAnswer, and zero text heuristics.
  - [Area 2: Interaction and Ask contract](areas/02-interaction-ask-contract.md): Questions, permissions, confirmations, correlation IDs, restart vs live-operation policies, and composer fallback.
  - [Area 3: Provider model catalog](areas/03-provider-model-catalog.md): Normalized `AgentModelDescriptor`, open hybrid catalog, permissive passthrough validation, and capability-governed model switching.
  - [Area 4: Provider capability model](areas/04-provider-capability-model.md): Clean separation of Transport Capabilities, Model Traits, Execution Modes, and Runtime Health.
  - [Area 5: Error and terminal result taxonomy](areas/05-error-terminal-taxonomy.md): Decoupled terminal outcomes, 12-code failure taxonomy, structured neutral recovery hints, and epistemic truth on lost operations.
  - [Area 6: Operation and process lifecycle](areas/06-operation-process-lifecycle.md): Process vs session vs turn lifetimes, Windows process tree termination, timeout ownership, and restart reconciliation.
  - [Area 7: Provider availability and metadata](areas/07-availability-metadata.md): Multi-state health model (`healthy`, `degraded`, `unavailable`), lightweight probing, and transient error isolation.
  - [Area 8: Diagnostics and raw capture](areas/08-diagnostics-raw-capture.md): Strict separation between canonical history and raw diagnostics, bounded flushes, and privacy isolation.

## Constraints

- **C1.** Server semantic boundary: Provider-specific IDs, protocol envelopes, and mapping heuristics end at the provider adapter. Nevo core and the browser consume normalized contracts.
- **C2.** Permissive model passthrough: Unknown or unlisted models pass through to the provider without validation rejection; the provider is the sole authoritative arbiter of model validity.
- **C3.** Runtime evidence precedence: Authoritative runtime protocol evidence always overrides advisory metadata or static catalog traits. Catalog metadata must never suppress evidenced provider output.
- **C4.** Capability-driven switching: Turn-level model selection is governed by the adapter capability `canOverrideTurnModel`.
- **C5.** Zero text heuristics: Interaction requests, tool calls, and errors must never be inferred by regex parsing of arbitrary text streams.
- **C6.** Headless composer fallback: For non-interactive providers or terminal text questions, turns complete with `finalAnswer` and users continue conversation via the composer.
- **C7.** Decoupled error taxonomy: Terminal outcomes (`completed`, `failed`, `cancelled`, `interrupted`), normalized failure codes (12 codes), and structured recovery hints are strictly separate fields.
- **C8.** Epistemic truth on lost operations: Lost operation handles transition to `status: 'unknown'`; they are never falsely marked as `failed` without authoritative evidence.
- **C9.** Safe process tree termination: Cancellation and timeouts terminate the entire process tree on all platforms (using Windows-native process tree termination on Windows).
- **C10.** Health and error isolation: Per-turn rate limits, quotas, or execution failures must never mark a provider descriptor globally unavailable or uninstalled.
- **C11.** Private diagnostics isolation: Raw diagnostic capture and logs remain server-side on disk and are strictly forbidden from public HTTP endpoints and SSE streams.
- **C12.** Atomic file persistence: Local adapter persistence files must use atomic writes (temp file + rename) to protect against corruption during unexpected termination.

## Acceptance criteria

1. **AC1: Discriminated error taxonomy & recovery hints**: Claude, Codex, and Antigravity adapters map provider-specific failures to normalized `AiError` taxonomy codes (`AI_AUTH_FAILED`, `AI_RATE_LIMITED`, `AI_QUOTA_EXHAUSTED`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_RUNTIME_TIMEOUT`, etc.) carrying structured neutral recovery hints (`none`, `retry-after-delay`, `new-turn`, `new-session`, `operator-action`, `alternate-provider`).
2. **AC2: Unified model catalog & discovery**: Provider descriptors expose `models: AgentModelDescriptor[]`. Antigravity enriches its catalog dynamically via `agy models` with 5-minute caching; Codex queries native `model/list`; Claude provides curated baseline metadata with operator overrides; unlisted models pass through permissively; omitted models preserve provider defaults.
3. **AC3: Durable adapter session encapsulation**: Antigravity encapsulates its asynchronous conversation alias mapping (`antigravity-sessions.json`) with atomic file writes (`tempFile` + `rename`) within the adapter boundary; session identity survives server restarts without leaking adapter internals into core services.
4. **AC4: Windows process tree termination**: `terminateChildProcess()` terminates the entire process tree on Windows using `taskkill.exe /PID <pid> /T /F` or Job Objects, preventing orphaned child processes upon cancellation or timeout.
5. **AC5: Decoupled capability and health models**: `AgentProviderDescriptor` separates transport `capabilities` (including `canOverrideTurnModel`, `toolCalls`, `reasoningEvents`), `models` (inference traits), `supportedModes` (security policies), and `health` (`enabled`, `installed`, `authenticated`, `status`).
6. **AC6: Four-layer output pipeline & evidence precedence**: Public SSE stream exposes normalized channels (`text.delta`, `progress.delta`, `reasoning.delta`, `tool.*`, `interaction.*`). Runtime evidence overrides advisory metadata; non-interactive questions settle cleanly as `completed` with `finalAnswer` for composer reply.
7. **AC7: Conformance suite validation**: Cross-provider conformance test suite verifies identical output semantics, interaction contracts, and terminal arbitration across Claude, Codex, and Antigravity.

## Out of scope

- Implementing automated retry loops, backoff timers, or fallback orchestrators (deferred to future orchestration changes).
- Implementing inter-agent handover or session migration between different providers.
- Building billing quota managers or account subscription monitors.
- Rewriting Antigravity's CLI binary or implementing unsupported mid-turn prompts in headless mode.
- Exposing raw provider diagnostic payloads to the browser.

