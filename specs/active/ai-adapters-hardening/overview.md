---
id: spec.ai-adapters-hardening
type: change
title: "AI adapters hardening"
status: draft
change: ai-adapters-hardening
---

# AI adapters hardening

## Status

Refined Architectural Specification (awaiting owner approval on [owner-decisions.md](owner-decisions.md) before task decomposition).

## Goal

Harden NEvo's AI adapter contracts, error handling, process lifecycles, and model catalog across Claude Code, OpenAI Codex, and Google Antigravity, such that provider-specific transport/protocol quirks remain strictly inside adapters while the rest of NEvo can rely on deterministic, consistent semantics.

The resulting contract provides the hardened foundation for later orchestration work (provider/model selection, automated retry/fallback, agent handover, quota handling), while keeping those orchestration features themselves strictly out of scope.

## Problem

Following the implementation of the canonical Turn and Work model (ADR-0008), deep repository discovery revealed several critical architectural and transport disparities across provider adapters:

1. **Error taxonomy collapse**: Materially different failures (invalid authentication, quota exhaustion, token rate limits, upstream outages, CLI exit 1, and process crashes) currently collapse into generic `AI_PROVIDER_ERROR` or `AI_PROVIDER_EXIT_ERROR` (HTTP 502). Downstream retry or fallback orchestration cannot make deterministic recovery decisions without parsing brittle provider error strings.
2. **Missing model catalog & discovery**: Provider descriptors contain zero model metadata. While `agy` natively supports dynamic discovery (`agy models`) and Codex/Claude accept model flags (`--model`), Nevo has no normalized model catalog schema, no distinction between discovered vs configured vs known models, and no model override propagation.
3. **Session identity asymmetry & alias store duplication**: Claude accepts client-assigned UUIDs, Codex generates authoritative thread IDs on a persistent daemon, and Antigravity allocates internal IDs during headless streaming. To handle resumption, Antigravity currently manages a private `.nevo-ai-local/antigravity-sessions.json` alias store, creating dual-state bookkeeping alongside `AgentSessionBindingService`.
4. **Windows process tree leaks**: Claude and Antigravity spawn CLI child processes that often run nested commands (bash, git, compilers, tests). On Windows, `process-termination.mjs` relies on `child.kill()`, which terminates only the root PID and leaves orphaned grandchild subprocesses running.
5. **Conflated availability and enablement**: The current boolean pair (`enabled`, `available`) conflates operator configuration (allow-list in `ai-providers.yaml`), binary installation, authentication state, and transient rate limits into a single `available` boolean.

## Document map

- [discovery.md](discovery.md): Comprehensive repository discovery report and 26-dimension provider comparison matrix across Claude, Codex, and Antigravity.
- [owner-decisions.md](owner-decisions.md): Architectural decision option analyses across 10 key decisions awaiting owner approval:
  1. Provider Model Catalog Strategy (Discovered vs Configured vs Known vs Provider Default)
  2. Model Selection Scope (Session vs Turn vs Capability-governed)
  3. Interaction Contract & Headless Adapter Policy
  4. Capability Ownership & Decoupling (Transport Capabilities vs Model Traits)
  5. Public vs Internal Event Vocabulary & Output Semantics (4-layer pipeline)
  6. Error & Failure Taxonomy vs Terminal Outcomes (Separation of outcome, code, and recovery hints)
  7. Lost / Unknown Operation Semantics (Epistemic truth preservation)
  8. Antigravity Session Identity & Alias Store Convergence
  9. Child Process Lifecycle & Windows Process Tree Termination
  10. Provider Availability vs Health Metadata Decoupling
- **Area specifications**:
  - [Area 1: Normalized output semantics](areas/01-normalized-output-semantics.md): Four-layer event transformation pipeline, canonical three-level Work hierarchy, orthogonal FinalAnswer, and zero text heuristics.
  - [Area 2: Interaction and Ask contract](areas/02-interaction-ask-contract.md): Questions, permissions, confirmations, correlation IDs, restart vs live-operation policies, and composer fallback.
  - [Area 3: Provider model catalog](areas/03-provider-model-catalog.md): Normalized `AgentModelDescriptor`, open hybrid catalog, permissive passthrough validation, and model selection scope.
  - [Area 4: Provider capability model](areas/04-provider-capability-model.md): Clean separation of Transport Capabilities, Model Traits, Execution Modes, and Runtime Health.
  - [Area 5: Error and terminal result taxonomy](areas/05-error-terminal-taxonomy.md): Decoupled terminal outcomes, 12-code failure taxonomy, structured neutral recovery hints, and epistemic truth on lost operations.
  - [Area 6: Operation and process lifecycle](areas/06-operation-process-lifecycle.md): Process vs session vs turn lifetimes, Windows process tree termination, timeout ownership, and restart reconciliation.
  - [Area 7: Provider availability and metadata](areas/07-availability-metadata.md): Multi-state health model (`healthy`, `degraded`, `unavailable`), lightweight probing, and transient error isolation.
  - [Area 8: Diagnostics and raw capture](areas/08-diagnostics-raw-capture.md): Strict separation between canonical history and raw diagnostics, bounded flushes, and privacy isolation.

## Acceptance criteria targets for implementation (Proposed)

*The following targets represent the proposed end-state upon owner approval of the decisions in [owner-decisions.md](owner-decisions.md):*

1. **AC1: Discriminated error taxonomy & recovery hints**: Claude, Codex, and Antigravity adapters map provider-specific failures to normalized `AiError` taxonomy codes (`AI_AUTH_FAILED`, `AI_RATE_LIMITED`, `AI_QUOTA_EXHAUSTED`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_RUNTIME_TIMEOUT`, etc.) carrying structured neutral recovery hints (`none`, `retry-after-delay`, `new-turn`, `new-session`, `operator-action`, `alternate-provider`).
2. **AC2: Unified model catalog & discovery**: Provider descriptors expose `models: AgentModelDescriptor[]`. Antigravity enriches its catalog dynamically via `agy models` with 5-minute caching; Claude and Codex provide curated baseline metadata with operator overrides; unlisted models pass through permissively; omitted models preserve provider defaults.
3. **AC3: Converged session aliasing**: `AgentSessionBindingService` natively handles session aliases with atomic persistence; Antigravity's standalone `antigravity-sessions.json` is migrated and deprecated.
4. **AC4: Windows process tree termination**: `terminateChildProcess()` terminates the entire process tree on Windows using `taskkill.exe /PID <pid> /T /F` or Job Objects, preventing orphaned child processes upon cancellation or timeout.
5. **AC5: Decoupled capability and health models**: `AgentProviderDescriptor` separates transport `capabilities` (protocol invariants), `models` (inference traits), `supportedModes` (security policies), and `health` (`enabled`, `installed`, `authenticated`, `status`).
6. **AC6: Conformance suite validation**: Cross-provider conformance test suite verifies identical output semantics, interaction contracts, and terminal arbitration across Claude, Codex, and Antigravity.

## Out of scope

- Implementing automated retry loops, backoff timers, or fallback orchestrators (deferred to future orchestration changes).
- Implementing inter-agent handover or session migration between different providers.
- Building billing quota managers or account subscription monitors.
- Rewriting Antigravity's CLI binary or implementing unsupported mid-turn prompts in headless mode.
- Exposing raw provider diagnostic payloads to the browser.
