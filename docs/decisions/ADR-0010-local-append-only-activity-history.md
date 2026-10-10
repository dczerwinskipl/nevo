---
id: adr.0009-local-append-only-activity-history
type: adr
title: Local append-only activity history for workflow execution
status: accepted
date: 2026-09-21
summary: Persist an observational, append-only Activity ledger under .nevo-ai-local for runtime execution facts without violating the git-as-history boundary.
supersedes: ~
superseded_by: ~
---

# ADR-0009: Local append-only activity history for workflow execution

## Status

Accepted (Source: specification `ai-spec-history`)

## Context

Nevo's workflow engine executes deterministic, generic steps and records state transitions in `change.yaml`'s `workflow_progress.history[]`. Session bindings (`.nevo-ai-local/sessions/`) and human verification records (`.nevo-ai-local/human-verifications/`) capture runtime facts when they happen. However, prior to this decision, nothing provided a durable, chronological history answering "what happened to this specification across all its tasks, in order, by whom, and because of what?"

Previous architectural decisions in this repository — specifically [ADR-0004](ADR-0004-review-artifacts-and-handoff.md) (review artifacts and handoff) and [ADR-0006](ADR-0006-process-continuity-and-hardening.md) (process continuity and hardening) — explicitly rejected event-sourced or history-preserving ledgers (such as numbered review files `reviews/review-<n>.md` or an event-sourced `follow-ups.yaml`). In both cases, the rationale was clear: **git already tracks history for free** for git-tracked artifacts, and a second, hand-maintained history or state-sync mechanism was a liability for state synchronization and workflow complexity.

A key architectural question arose when introducing an Activity history: does a local append-only Activity ledger repeat the pattern that ADR-0004 and ADR-0006 rejected?

The critical distinction is the boundary between **git-tracked** and **git-ignored** state:
- The precedents in ADR-0004 and ADR-0006 applied exclusively to **git-tracked** artifacts (such as specification files, review reports, and follow-up manifests). For those files, Git already captures every revision, commit, and authorial change. Adding a bespoke application-level ledger or numbered file history for git-tracked files would duplicate Git's native version control.
- In contrast, runtime execution facts — such as ephemeral AI agent session IDs, physical turn bindings, human operator verification signoffs, workflow attempt counts, and causal trigger chains — live under `.nevo-ai-local/`, which is **git-ignored**. Git captures nothing about this runtime state. Because Git provides no history for git-ignored state, Git cannot substitute for history here.

Without a dedicated local Activity ledger, runtime execution facts are lost as soon as attempts advance or turn contexts change. A local, append-only Activity ledger under `.nevo-ai-local` is therefore not a repeat of the pattern rejected in ADR-0004 and ADR-0006, but an essential mechanism to capture git-ignored runtime execution facts without polluting the Git tree with machine-local or transient execution data.

## Decision

We establish a local, append-only Activity history ledger adhering to the following durable architectural principles:

### 1. Observational, not authoritative

The Activity ledger is strictly observational and never the workflow engine's source of truth. The specification manifest (`change.yaml`)'s `workflow_progress` remains the sole authoritative source of truth for workflow states and transitions. Activity recording failures are non-blocking and must never fail or roll back the underlying workflow operation.

### 2. Storage location, granularity, and permanence (no pruning)

- **Storage path**: One append-only NDJSON file per specification at `.nevo-ai-local/activity/<specId>.ndjson`, keyed by the immutable `spec_id` UUID from `change.yaml`. This ensures the activity log survives change-slug renames.
- **Single stream**: Both spec-level and task-level entries are written to this single per-spec file. Queries for task-scoped, spec-only, or full specification history filter over this one file without requiring multi-file merges or timestamp re-sorting.
- **Physical order**: Ordering is determined by physical line append order in the file.
- **No pruning**: Unlike diagnostic trace logs (`.nevo-ai-local/lifecycle_traces/`), which are pruned by turn or count, the Activity ledger is a permanent local history. It must remain readable for the life of the specification, including after specification archival (Owner Decision D2).

### 3. Extensible envelope and producer namespacing

The Activity record envelope is fixed, stable, and schema-versioned:

```ts
type ActorRef = { type: string; id: string };

type Activity = {
  id: string;             // Deterministic or UUID v4
  type: string;           // Namespaced dot-separated type string
  schemaVersion: number;  // Envelope version (currently 1)
  occurredAt: string;     // ISO-8601 UTC timestamp
  actor: ActorRef;        // 'user' | 'agent-session' | 'system'
  initiatedBy?: ActorRef; // Origin of the execution chain
  triggeredBy?: string;   // ID of the prior Activity record that caused this
  scope: { specId: string; taskId?: string };
  data?: unknown;         // Producer-owned, producer-validated payload
};
```

Extensibility is achieved via namespaced dot-separated `type` strings (e.g. `workflow.step.started`, `workflow.step.completed`, `human.verification.confirmed`). Each event type is owned and validated by its producer module; the core store treats `data` as an opaque payload. Adding a new activity type requires adding a new producer module with its own type constant and data contract, requiring no changes to the core envelope, store, or query layer (Owner Decision D7, D9). Future producers must adhere to this contract.

### 4. Actor model and late presentation resolution

Activity records store stable identity references `{ type, id }`:
- `user`: Resolved from local git config (`git config user.name` / `user.email`).
- `agent-session`: Resolved from canonical agent session bindings (`binding.sessionId`).
- `system`: Fixed system identity constant (`{ type: 'system', id: 'nevo-workflow-engine' }`).

Display names are not snapshotted into individual activity records. Human presentation display names are resolved late at presentation time rather than duplicated across ledger lines, preserving historical integrity while avoiding identity drift issues across local environments.

### 5. Idempotency and resumability

- **Deterministic IDs**: Activity producers derive deterministic IDs from stable identifiers (`${type}:${specId}:${taskId}:${step}:${attempt}`).
- **Read-side deduplication**: The Activity store reads records using at-least-once appending and deduplicates by `id` on read (keeping the first occurrence in physical file order). This eliminates the need for cross-process file locks or read-modify-write cycles during appends.
- **Durable actor capture on finish operations**: For resumable finish operations (`finishStep`), the actor is captured once into the durable operation record at creation time (`createOperationRecord`). Resumed executions read `record.actor`, preventing misattribution when an interrupted operation is resumed by a different session or actor.

## What was deliberately not adopted

- **Event sourcing for workflow state**: Workflow state transitions remain explicitly modeled in `change.yaml`'s `workflow_progress`. Activity records never drive state transitions.
- **Diagnostic trace unification**: The Activity ledger is kept strictly separate from `LifecycleTraceSink` (`.nevo-ai-local/lifecycle_traces/`). Diagnostic traces capture raw, low-level turn diagnostics and are aggressively pruned, whereas Activity history provides a permanent, human-scannable timeline.
- **Git-tracked activity ledgers**: Persisting runtime execution history in Git-tracked specification directories was rejected to avoid Git commit noise and merge conflicts from machine-local execution state.
- **Write-side locking**: Because appends are single-write and deduplicated by ID on read, lock files for activity appends were avoided.

## Consequences

- Specifications now possess a complete, chronological audit trail of "who did what, when, and because of what" across all tasks.
- Future activity producers must follow the namespaced `type` and producer-validated `data` architecture established here (D9).
- The boundary between git-tracked specification truth and git-ignored local runtime activity is formally codified and preserved.
