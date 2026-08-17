# Solution options

## Context

This class A change alters the specification manifest contract, dashboard HTTP API, CLI shape, local persistence ownership, and provider boundary. The selected architecture must deliver a useful mock-backed vertical slice without Claude, preserve provider-owned transcripts, support interactive turns, and leave a verified path to real Claude sessions without coupling the browser to Claude.

## Options

### Option 1: Dashboard-specific mock followed by direct Claude wiring

- **Proposed because:** It has the smallest initial code footprint.
- **What changes / what stays the same:** Add session components and mock endpoints directly to the dashboard, then add Claude-specific routes later. Existing spec tooling stays slug-based.
- **Complexity:** M
- **Trade-offs considered:** Lowest Part 1 cost, but high contract churn, duplicated session semantics, provider-specific UI coupling, and no stable relation key.
- **Coupling/boundary check result:** Couples browser contracts to one backend/provider implementation and cannot safely share registration with the CLI.
- **Unlocks:** Fast visual prototype.
- **Forecloses:** Adding Codex/Copilot without redesign; durable relations across slug changes; independent contract testing.
- **Good fit when / bad fit when:** Good only for a disposable prototype; bad for the requested two-part delivery.

### Option 2: Shared provider-neutral tooling core with adapters — selected

- **Proposed because:** It matches the owner's required final shape while staying inside the existing Node tooling and dashboard process.
- **What changes / what stays the same:** Add immutable `spec_id`, a small shared `tools/ai/**` domain/runtime boundary, adapter capabilities, mock and Claude adapters, normalized HTTP/SSE contracts, and an ignored local registry. Keep transcripts with providers and keep framework `src/**` packages unchanged.
- **Complexity:** XL
- **Trade-offs considered:** More up-front contract and test work than Option 1, but lower long-term maintenance, no new service, no new runtime package by default, and a clean Part 1/Part 2 seam.
- **Coupling/boundary check result:** The dashboard and specs CLI depend downward on shared internal tooling; no `src/NEvo.*` package gains a dependency and no browser code imports provider-specific modules.
- **Unlocks:** Later Codex/Copilot adapters, OIDC authorization policy, provider capabilities, mock-only demos, and CLI/dashboard reuse.
- **Forecloses:** Provider-specific shortcuts that bypass the normalized turn/session contract.
- **Good fit when / bad fit when:** Good for a local multi-provider dashboard; bad only if NEvo intends a separate remotely deployed AI platform now.

### Option 3: Standalone AI service with durable runtime and transcript projection

- **Proposed because:** It offers the strongest process isolation and future remote deployment boundary.
- **What changes / what stays the same:** Add a new service/project, durable turn engine, authenticated API, provider workers, and a transcript projection store.
- **Complexity:** XXL
- **Trade-offs considered:** Strong isolation and recovery, but new projects/dependencies, duplicated provider data, deployment/authentication scope, and substantially broader testing.
- **Coupling/boundary check result:** Introduces a new package/service dependency direction and operational boundary requiring separate architectural decisions.
- **Unlocks:** Multi-user/cloud deployment and durable process recovery.
- **Forecloses:** The requested small local vertical slice and provider-as-transcript-source simplicity.
- **Good fit when / bad fit when:** Good for a future hosted product; bad for the current workstation-local scope.

## Acceptance criteria coverage

| Criterion | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Part 1 works without Claude | Full | Full | Full |
| Frontend remains provider-neutral | Partial | Full | Full |
| Stable spec/session relations | No | Full | Full |
| Provider owns transcripts | Partial | Full | No |
| Interactive turn and reconnect model | Partial | Full | Full |
| Two independently reviewable parts | Partial | Full | Partial |
| No unnecessary service/dependency | Full | Full | No |
| Concurrent local registration | No | Full | Full |

## Recommendation

Use Option 2. It is the only option that fully satisfies the owner-defined provider neutrality, stable identity, provider-owned history, interactive turns, local concurrency, and two-part delivery without introducing a new service.

- Option 1 is rejected because its lower initial cost is paid back as a Part 2 contract rewrite and it cannot satisfy stable provider-neutral relations.
- Option 3 is rejected because durable orchestration, authentication, deployment, and transcript projection are explicitly outside the current scope.

## Confirmation

The owner supplied the Option 2 direction in the initial brief and subsequent interaction decisions. On 2026-08-15 the owner additionally selected one-time `spec_id` backfill and trusted VPN access with a replaceable authorization-policy seam; token pairing was rejected as unnecessary before the planned OIDC specification.
