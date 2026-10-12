---
id: adr.0012-session-continuity-choice
type: adr
title: Session continuity choice and sequential continuation
status: accepted
date: 2026-10-12
summary: Establish owner session continuity choice at workflow step start bounded by workflow definitions, and durable sequential continuation for batched task sessions.
supersedes: ~
superseded_by: ~
---

# ADR-0012: Session continuity choice and sequential continuation

## Status

Accepted (Source: specification `session-continuity-choice`, Owner Decisions D1–D4)

## Context

In Nevo's multi-provider agent session model (ADR-0007, ADR-0008, ADR-0009), deterministic workflow step transitions previously enforced a rigid session lifecycle:
- Each transition declared a fixed `execution.session` (`fresh` or `reuse`).
- For human verification request-changes or rework after failed review, starting a fresh session meant the agent lost conversational context, file modification history, and design rationale from earlier turns.
- Hardcoding reuse across the board compromised review independence when reviewing code changes.
- For multi-task selections ("Review together"), the engine supported only single-session batch reviews (`reviewTogether: true`). There was no mechanism to continue each task in its respective session while respecting ADR-0009's invariant of exactly one active execution per specification.

## Options Considered (Decision D1)

We evaluated three architectural alternatives for session continuity:

1. **Option 1: Minimal automatic reuse (Rejected)**
   - Hardcode `session: reuse` in `standard-v1` for request-changes and review-fail transitions without soliciting owner input.
   - *Why rejected:* Eliminates owner discretion, applies unconditionally to all specifications, and defaults to selecting the *review* session on request-changes (since the server would pick the latest agent step with a session) rather than the original implementation session.

2. **Option 2: Bounded owner choice with definition contracts (Accepted)**
   - The workflow definition declares the default policy, permissible policies (`allow`), and the candidate predecessor step (`reuseFrom`).
   - At step start, the dashboard asks the owner ("continue in session X" vs. "new session"), defaulting per transition rules and warning on reduced review independence.
   - The server validates the choice fail-closed against the definition and provider compatibility.
   - Multi-task batches run sequentially in selection order.

3. **Option 3: Free-standing session work threads (Rejected)**
   - Re-model sessions as long-lived, step-independent work threads per task, detached from workflow steps.
   - *Why rejected:* High architectural churn that overcomplicates session boundaries when the existing `execution.session` and turn runtime already model step execution effectively.

## Decision

We adopt Option 2, codified across the following core decisions:

### 1. Workflow Definition Extension (D1, D2)
Transitions in workflow definitions (`standard-v1.yaml`) optionally declare:
- `execution.session`: default policy (`'fresh'` | `'reuse'`).
- `execution.allow`: allowed policies (`Array<'fresh' | 'reuse'>`). When omitted, defaults to `[session || 'fresh']`.
- `execution.reuseFrom`: step name whose session is the candidate for reuse. Required when `allow` includes `'reuse'`.

`standard-v1` is extended backward-compatibly without requiring a `standard-v2`:
- `human-verification -> implementation` (request changes): defaults to `session: reuse`, `allow: ['reuse', 'fresh']`, `reuseFrom: implementation`.
- `implementation -> review`: defaults to `session: fresh`, `allow: ['fresh', 'reuse']`, `reuseFrom: implementation`. Continuing in the implementation session is available as an explicit override.

### 2. Server Resolution and Validation (D1)
When admitting agent execution (`/api/agent-sessions/turns`):
- `DISALLOWED_SESSION_POLICY` (400): Client requested a policy not declared in transition's `allow`.
- `NO_REUSE_CANDIDATE` (400): Policy is `reuse`, but no prior session exists in task history for `reuseFrom`.
- `PROVIDER_MISMATCH` (400): Candidate session provider does not match the active execution policy provider.
- `MISSING_REUSE_FROM` (500): Workflow definition declares `allow: ['reuse']` without specifying `reuseFrom`.

Candidate sessions are projected to clients in `actions.tasks[taskId].sessionChoice` DTO:
- `default`: default policy.
- `allowed`: allowed policies.
- `candidate`: candidate session metadata (`sessionId`, `step`, `attempt`, `provider`, `label`).
- `unavailableReason`: error code and message explaining why reuse is blocked (e.g. provider mismatch or missing candidate).

### 3. Sequential Continuation for Multi-Task Batches (D3)
To respect ADR-0009's invariant (one active execution per specification):
- Continuing multiple tasks in their own sessions runs turns **sequentially**, in selection order, never concurrently.
- Chains are persisted durably at `.nevo-ai-local/sequential-continuation/<changeSlug>/<chainId>.json`.
- The first task is admitted immediately. When Hook 1 detects clean turn completion (`assessExecutionSettlement` yields `outcome: 'completed'`), it advances and admits the next task.
- If a turn does not settle cleanly (`resumable` or `recovery-required`), the chain stops cleanly and marks subsequent tasks as `not-started`.
- Boot reconciliation (`sweepAllPendingHandovers`) scans for active chains and resumes execution after daemon or server crashes.

### 4. Review Independence Warning (D4)
When continuing an implementation session for a review step, the UI displays an explicit warning highlighting reduced review independence.

## Consequences

- Existing definitions continue functioning unchanged; new fields are optional.
- Operators gain full visibility and control over session continuity at step start.
- Multi-task reviews can either be evaluated together in a single batch session (`reviewTogether: true`) or sequentially across respective implementation sessions (`batchContinuation: true`).
