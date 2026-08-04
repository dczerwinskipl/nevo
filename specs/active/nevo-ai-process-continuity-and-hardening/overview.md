---
id: spec.nevo-ai-process-continuity-and-hardening
type: change
title: NEvo AI workflow process continuity and hardening
status: draft
change: nevo-ai-process-continuity-and-hardening
---

# NEvo AI workflow process continuity and hardening

> **Refinement note (2026-08-04):** this document was revised after an owner-supplied
> refinement pass that found nine contradictions/underspecified return paths in the
> original draft (recorded as owner decisions D7-D15 in `owner-decisions.md`). The
> original problem statement, scope, and direction (D1-D6) are unchanged; this revision
> corrects internal consistency, not intent.
>
> **Second refinement note (2026-08-04):** a follow-up review found eight further
> corrections — an unsafe unreachable-but-valid status vocabulary, a gap between
> combined-transition confirmation and repair-and-retry semantics, prose-inferred
> fingerprint dependency references, missing evidence freshness in the gating batch
> review, an underspecified batch-selection model, a missing task dependency on the
> follow-up mechanism, a still-prose follow-up ledger format, and an overstated
> post-merge "recovery anchor" — recorded as D16-D23. Direction (D1-D15) is unchanged;
> this pass, like the first, corrects internal consistency and determinism, not intent.
>
> **Third refinement note (2026-08-04):** a final review found three remaining
> corrections — a full task review could substitute for a failed self-check instead of
> the batch hard-stopping, the post-merge repair-branch guard order and "stops without
> modifying anything" wording claimed stronger atomicity than Git provides, and
> `semantic_references` completeness (as opposed to integrity) had no check at all —
> recorded as D24-D26. Direction (D1-D23) is unchanged; this pass corrects the same two
> things every prior pass has: internal consistency and determinism, not intent.

## Context

The `/nevo-ai:*` workflow (this document, `AGENTS.md`, `docs/ai/specification-workflow.md`,
`tools/specs.mjs`) has now shipped a full change end-to-end
(`nevo-documentation-architecture`, 17 tasks). That real usage — plus a deliberate
verification pass against the current tooling — surfaced friction that is process-shaped,
not feature-shaped: the workflow behaves like a set of independently-invoked commands
more than a recoverable state machine, even though the deterministic pieces it already
has (`deriveStage`, the transition table, the fingerprint gate) are closer to that shape
than the conversational layer on top of them lets on.

This change treats that friction as a hardening initiative: keep the deterministic,
human-led, spec-anchored model; reduce repeated model work, repeated context loading, and
approval ceremony where a real gate isn't at stake; let the AI continue through safe
transitions; stop only for a genuine owner decision, an unsafe recovery, a requested
checkpoint, or the end of a requested batch.

## Current architecture

Reconstructed and verified against `tools/specs.mjs`, `tools/specs/lifecycle.mjs`,
`tools/specs/service.mjs`, `tools/specs/validation.mjs`, every `.claude/commands/nevo-ai/*.md`,
and the skill references, as of this change's discovery pass. Unchanged by the
refinement pass — the defects below are still exactly as verified.

### States (task-level)

`TERMINAL_STATUSES = {implemented, verified, archived, abandoned}` (`lifecycle.mjs:7`).
`READY_STATUSES = {approved}` (`lifecycle.mjs:8`). The deterministic transition table
(`lifecycle.mjs:29-34`):

| Command | From | To |
|---|---|---|
| `approve` | `draft` | `approved` |
| `start` | `approved` | `in-implementation` |
| `complete` | `in-implementation` | `implemented` |
| `verify` | `implemented` | `verified` |

Two more task statuses exist in the vocabulary — `blocked`, `needs-decision`
(`service.mjs:164`, referenced by `tools/tests/task-lifecycle.test.mjs:47-53` as invalid
`from` states for `approve`/`start`) — but **no command ever writes them**. They are
reachable today only by hand-editing `change.yaml`. **This change removes them from the
vocabulary entirely (D16)** — the first refinement pass (D8) had only decided not to
make them *reachable*, leaving them valid-but-dead in `validateSpecs`/`STATUS_ORDER`; a
second refinement pass flagged that as unsafe in its own right (a value validation
accepts but no transition can ever leave), so this change now deletes them outright and
makes setting either one a `validate` error, both at task level and at the
change-level `ACTIVE_CHANGE_STATUSES` set below. `superseded` exists only in
`service.mjs:163-166`'s `STATUS_ORDER`, used solely to sort the generated Markdown
index; it is not in `TERMINAL_STATUSES`, not in `TRANSITIONS`, and no code ever sets it.

### States (change-level)

`ACTIVE_CHANGE_STATUSES = {approved, in-implementation, needs-decision, draft, blocked}`
(`lifecycle.mjs:9`). `validateSpecs()` (`validation.mjs:8-64`) checks only that
`change.status` is *present* — there is no enum/allowlist check on its value. **This
change removes `needs-decision`/`blocked` from this set too and adds the enum check
that was never there (D16)** — today `change.status` could already be hand-set to
either value with no validation error at all; after this change it cannot.

### Persisted vs. derived state

Persisted: `change.yaml` (change/task status, `depends_on`, `branch`, task file
pointers), task/area/overview front matter and body (including, per-task,
`semantic_references` — D18), `reviews/*.md` (verdict, resolved counts, fingerprint(s) —
see D7), a per-task `execution.suspension` block (D8, new), a per-batch intent file (D10,
new — intent only, not progress), a `follow-ups.yaml` ledger (D15, D22).

Derived, recomputed on demand, never stored: `depsSatisfied`/`isTaskReady`
(`lifecycle.mjs:11-21`), the fingerprint tiers (D7), `validateFinalize`'s gate facts
(`lifecycle.mjs:131-191`), `deriveStage` (`lifecycle.mjs:207-284`), and — new in this
change — batch progress (completed/current/next/failed tasks, derived from task status +
suspension per D10, never persisted redundantly).

### Fingerprint (confirmed defect, now generalized — D7)

`computeSpecFingerprint` (`service.mjs:128-153`) hashes the **raw bytes** of
`change.yaml` plus every `overview.md`/`owner-decisions.md`/area/task file — not
extracted content fields. Because `change.yaml` carries every task's `status` inline, any
task's status transition changes the hash for the *entire change*, invalidating the
`spec_fingerprint` embedded in a review for a completely unrelated task
(`validateApproval`, `lifecycle.mjs:100-106`). The original fix (D1: exclude `status`)
is necessary but not sufficient — a single change-wide fingerprint still over-invalidates
when the draft gains a mechanical task, a resolver task, a new dependency, a discovered
follow-up, an unrelated task, or a task-local context correction, reproducing the same
cost under a different trigger. D7 replaces the single-hash-with-exclusions approach with
a three-tier canonical semantic projection — see "Proposed architecture" below. D7's
task-level tier originally scoped its dependency/decision/constraint inputs to whatever a
task "actually references," in prose; D18 (second refinement pass) replaces that with an
explicit `semantic_references` schema block so which dependencies/decisions/constraints
feed a task's fingerprint is a checkable fact, not something tooling infers.

### Recovery and errors

Every failure is a `CliError` (or uncaught exception) caught once, at the top of
`runCli` (`tools/specs.mjs:440-452`), printed, `process.exitCode = 1`. No error
classification, no machine-readable codes, no retry logic anywhere in `tools/specs.mjs`,
`lifecycle.mjs`, or `tools/lib/git.mjs`. `handleStart` (`tools/specs.mjs:135-168`)
persists `in-implementation` **after** branch creation/checkout (line 163, after lines
152-158) — not before any action at all, but before any real file edit, so a session that
ends right after `start` leaves a task "in progress" with an empty diff — a partial
success the original draft's status-transition-only retry model could not reliably
recover from (see D8/finding 4: recovery now reasons about action *postconditions*, not
only status). `branchExists` (`tools/lib/git.mjs:18-25`) checks only the local ref; a
branch that exists on `origin` but not locally is not detected, and `start` would create
a diverging local branch rather than checking out the remote one.

### Resume

`tools/specs.mjs status` → `deriveStage` already computes a single, deterministic
`{stage, detail, nextCommand}` across the whole task→PR→merge chain, evaluated top to
bottom, first match wins (`lifecycle.mjs:207-284`), and `/nevo-ai:spec-status.md` already
surfaces it. But `spec-status.md` explicitly instructs: "Do not act on `nextCommand` from
this command" — the computation exists; only the "then act on it" step is missing.

### Conversational shape

Verified directly from `.claude/commands/nevo-ai/*.md`:
- `spec-review.md` ends by printing a `Next command` text block; it never invokes
  `spec-approve` itself in the same turn.
- `spec-approve.md` offers exactly three outcomes and explicitly forbids combining
  approval with start — a deliberate, documented design choice (relaxed under D3's
  explicit conditions, not removed).
- `task-review.md` computes but doesn't act on its own next-task/archive recommendation.
- No command supports running more than one task per invocation.
- `spec-finalize.md`'s gate (`validateFinalize`) is entirely pre-merge; nothing re-checks
  `main`'s state after the squash-merge completes, and (found only during the refinement
  pass) the original post-merge-check design would have mutated an already-archived
  change to record a failure — see D9.

### Context, scope, and validation

`tools/specs.mjs context` (`service.mjs:65-93`) echoes a task's declared
`context.required`/`optional`/`allowed_paths`/`forbidden_paths` verbatim — no derivation,
no completeness check. `docs/ai/task-routing.md`/`docs/ai/change-impact-map.md` are
free-form prose today; the original draft assumed a parser could read them
deterministically, which the refinement pass correctly flagged as not a stable contract
(D12). `allowed_paths`/`forbidden_paths` are enforced only by instruction at
`task-review` time. No task-level `type`/`kind` field exists anywhere in the schema.
`validateSpecs()` never validates `allowed_paths`, `forbidden_paths`, or
acceptance-criteria content — only ids, `depends_on` resolution/cycles, and `task.file`
existence.

### Review, audit, and evidence

Review evidence is already reasonably compact and structured. A review file is fully
overwritten on every run. `spec-audit` is explicitly non-gating and never re-checks a
task's own acceptance criteria — there is no gating batch/change-wide integrity review
anywhere in the current process, and no batch-execution support at all.

## Problem decomposition

| Area | What it resolves | Status |
|---|---|---|
| State & fingerprint semantics | Original findings #7/#17 + refinement findings 1, 2, 3 (partially — canonical scenario IDs live in area `recovery-and-resume`) + second-pass findings 1, 3 + third-pass finding 3 | Real, verified; refined three times |
| Recovery & resume | Original findings #13/#14 + refinement findings 3, 4 + second-pass finding 2 + third-pass finding 1 (cross-reference only — see D24) | Real, verified; refined three times |
| Conversational continuity & approval ergonomics | Original findings #15/#16 + second-pass finding 2 | Real; deliberate reversal (D3); refined |
| Batch execution & gating review | Original findings #10/#18/#19 + refinement findings 5, 6 + second-pass findings 4, 5, 6 + third-pass finding 1 | Real, verified, absent entirely; refined three times |
| Context & scope hardening | Original findings #1/#2/#3/#20/#4/#6 + refinement findings 9, 10 + second-pass finding 7 | Real, verified; refined twice |
| Finalization & migration | Original finding #23 + refinement findings 8, 12 + second-pass finding 8 + third-pass finding 2 | Real, verified; refined three times |

### Findings rejected or already resolved (unchanged from the original pass)

- Review evidence is already compact and structured.
- Source-of-truth precedence is already explicit in `AGENTS.md`; the concrete gap was the
  `docs/ai/specification-workflow.md:61` contradiction, fixed in task 11.
- `deriveStage` already exists as the deterministic "what's next" computation; only
  acting on it was missing.
- `tools/specs.mjs` itself has no duplicated next-step computation.

### Findings from the refinement pass — resolution summary

| # | Finding | Resolution |
|---|---|---|
| 1 | Recoverable stops used as new lifecycle statuses with no return path | Reversed — `execution.suspension`, orthogonal to stable status (D8) |
| 2 | Single change-wide fingerprint still over-invalidates | Three-tier semantic projection + invalidation matrix (D7) |
| 3 | "Eight" scenarios, nine listed | Corrected to nine, canonical `REC-01`..`REC-09` identifiers (area `recovery-and-resume`) |
| 4 | Retry relied on status transitions, not postconditions | Postcondition-based recovery model per action (D8, area `recovery-and-resume`) |
| 5 | `src/**`/`tests/**` touch alone triggers full review, defeating batch savings | Evidence-based risk signals (D11) |
| 6 | Duplicated batch progress state (`.batch-state.json` vs. `change.yaml`) | Derived-state model — intent persisted, progress derived (D10) |
| 7 | Follow-up ledger called append-only but has mutable status | Mutable current-state list (D15) |
| 8 | Post-merge failure could mutate an already-finalized change | Verify-before-destructive-cleanup sequencing (D9) |
| 9 | Routing docs assumed a stable parseable contract that doesn't exist | Validated table + generated JSON index (D12) |
| 10 | Free-form `context_exception` proves nothing | Decision-ID-referenced exceptions, included in the fingerprint (D13) |
| 11 | "Auto-approved" ambiguous for mechanical tasks | "Review-exempt deterministic approval" (D14) |
| 12 | Final task concentrated E2E tests + docs + ADR + index regen in one late sink | Split into task 10 (tests) → task 11 (docs/ADR/migration) |

### Findings from the second refinement pass — resolution summary

| # | Finding | Resolution |
|---|---|---|
| 1 | `blocked`/`needs-decision` left valid-but-unreachable — a state validation accepts but no transition can leave | Fully removed from the status vocabulary (task- and change-level); `validate` rejects either value (D16) |
| 2 | Combined approve+start had no defined behavior for a recoverable stop inside `start` — risked requiring a second command invocation | Repair-and-retry: a `confirm-required` stop resumes the same authorized loop after confirmation; five-value postcondition-outcome vocabulary (adds `unsafe_manual`) (D17) |
| 3 | Task fingerprint's dependency/decision/constraint inputs were prose ("actually references"), not deterministic | Explicit `semantic_references` schema block (`decisions`/`constraints`/`dependency_contracts`) (D18) |
| 4 | Gating batch review could pass on evidence a later batched task had already invalidated | Evidence-freshness check (staleness by file/command/fingerprint) required immediately before the gating review (D19) |
| 5 | "All currently ready tasks" cannot express "all approved tasks reachable through the graph" for a linear chain | Four named selection modes: `currently-ready` / `all-approved-reachable` / `named-subset` / `until-checkpoint` (D20) |
| 6 | Batch task's `change.yaml` entry never depended on the follow-up mechanism its gating review reads | `scope-and-follow-up-mechanisms` added to task 08's `depends_on`; a `mechanical-task-type` dependency was evaluated and found unnecessary (D21) |
| 7 | Follow-up ledger was still prose Markdown, not something deterministic tooling can parse reliably | `follow-ups.yaml`, structured and schema-validated (D22) |
| 8 | The preserved merged branch was called a "recovery anchor" but doesn't itself repair `main`; the repair path wasn't defined | Renamed "diagnostic anchor"; guarded, confirm-then-create repair-branch step with four preconditions (D23) |

### Findings from the third refinement pass — resolution summary

| # | Finding | Resolution |
|---|---|---|
| 1 | A failed/unresolved self-check was one of D11's risk signals — routed to full review instead of stopping the batch, letting a review substitute for a real fix | Split into disjoint hard-stop conditions (batch halts, correct-then-rerun) vs. full-review risk signals (evaluated only after self-check passes) (D24) |
| 2 | Repair-branch guard order let `main` be switched/fast-forwarded before the SHA/branch-name guards ran, so "stops without modifying anything" was inaccurate on a late guard failure | Guards reordered to front-load every read-only/remote check before any local mutation; failure wording now reports any read-only fetch or authorized switch/fast-forward that already occurred (D25) |
| 3 | `validateSpecs` can confirm a `semantic_references` entry exists, not that the list is *complete* — a forgotten reference leaves a task's review incorrectly fresh | Explicit model-review completeness check added to `/nevo-ai:spec-review`, alongside the unchanged deterministic integrity checks (D26) |

## Constraints

- Keep the spec-anchored, human-led model (`AGENTS.md`, ADR-0002).
- No autonomous approval of architectural/scope/API/compatibility decisions — the
  `AGENTS.md` gate list is unchanged by this work.
- No destructive worktree operation without explicit confirmation.
- No implicit scope expansion — the mechanical/consequential-path allowance is narrow and
  auditable, not a general license.
- Parallel task execution is not introduced; "batch" means sequential, one active task at
  a time.
- No external infrastructure (databases, queues, workflow engines).
- No new persisted lifecycle statuses (D8 reinforces this: recoverable stops use
  `execution.suspension`, not new statuses); the two pre-existing, never-reachable
  statuses (`blocked`, `needs-decision`) are removed outright, not merely left
  unreachable (D16).
- A confirmation already given for an authorized combined transition (D3) is not asked
  for twice — a `confirm-required` recovery inside that transition resumes the same
  authorized loop once confirmed, it does not force a fresh command invocation (D17).
- `tools/specs.mjs approve`'s own approval gate remains the sole enforcement point for
  `approved` — mechanical tasks still go through it (D14); combined approve+start (D3)
  still performs it as a distinct, auditable call.
- No implementation begins under this specification itself — this change only specifies.

## Affected modules

`tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`,
`tools/specs/validation.mjs`, `tools/lib/git.mjs`, `tools/lib/cli-errors.mjs`,
`tools/lib/github.mjs`, `tools/docs.mjs`, `tools/tests/*.test.mjs`,
`.claude/commands/nevo-ai/*.md`, `.claude/skills/nevo-ai-spec-workflow/**`,
`docs/ai/specification-workflow.md`, `docs/ai/task-routing.md`,
`docs/ai/change-impact-map.md`, `AGENTS.md`, `CLAUDE.md` (pointer only). No `src/**`
package is touched.

## Options and trade-offs

Full option sets for the original scope were presented to and decided by the owner — see
`owner-decisions.md` D1-D6. The first refinement pass's required models (D7-D8, D10-D15)
were supplied as explicit, prescriptive directives by the owner rather than open menus,
and were applied directly per the refinement instructions; the one genuine three-way fork
(post-merge failure handling, D9) is flagged in its own entry with the rationale for the
option chosen, since the refinement request explicitly delegated that specific choice to
this step rather than reserving it for a fresh owner turn. The second refinement pass's
corrections (D16-D22) were similarly prescriptive; its one genuine fork — whether a
post-merge repair branch is auto-created after confirmation or only reported as a command
— was presented to the owner directly in this pass and decided as D23 (auto-create, with
four preconditions guarding the creation). The third refinement pass's corrections
(D24-D26) were fully prescriptive with no unresolved fork — each stated its required
behavior and wording directly — and were applied without a further owner turn.

## Owner decisions

See `owner-decisions.md` — D1 through D26, all recorded 2026-08-04.

## Proposed architecture

### State model

No task status is added. `blocked`/`needs-decision` are **removed** from the valid
status vocabulary at both the task level and the change level — the first refinement
pass (D8) had left them valid-but-unreachable; the second (D16) removes them outright,
since a value validation accepts but no transition can ever leave is itself a defect, not
a harmless residue. `validateSpecs` now enum-checks `change.status` (previously
unchecked beyond presence) and task `status` against the corrected vocabulary; setting
either removed value to either field is a `validate` error reading `` Status `blocked` is
no longer supported. Use `execution.suspension`. `` (and the `needs-decision`
equivalent). `TRANSITIONS` (`lifecycle.mjs:29-34`) is not modified — the refined recovery
model no longer needs new statuses, so the original constraint against touching it turns
out to hold in practice, not just in intent.

**Execution suspension (D8, new)** — orthogonal to lifecycle status, persisted per task:

```yaml
# inside a task's entry in change.yaml, optional, present only while suspended
execution:
  suspension:
    kind: automatic | confirm-required | owner-decision | unsafe-manual
    code: <REC-xx identifier, see area recovery-and-resume>
    previous_action: <the operation to retry, e.g. start, continue-implementation>
    created_at: <ISO timestamp>
```

- **Persisted, not derived** — the reason an action stopped is not always
  re-derivable from git/filesystem state alone (e.g. "owner decided this needs scope
  clarification" is a judgment already made, not something to re-detect).
- **The stable lifecycle `status` field is never overwritten by a suspension** — a task
  that was `approved` and failed to `start` stays `approved` with a suspension attached;
  a task `in-implementation` that hits a mid-implementation blocker stays
  `in-implementation` with a suspension attached.
- **Cleared** when the recovery resolves (automatic fix applied, confirmation given and
  the confirm-required action completes, or the owner decision is recorded and the
  original action re-validated) — the `execution.suspension` block is removed entirely,
  not set to some "cleared" value.
- **Retry target** is `previous_action` — the controller (area `recovery-and-resume`)
  re-runs exactly that operation, never a substitute, after re-validating its
  preconditions still hold (see "Recovery model" below — a precondition that no longer
  holds is a **new** suspension, not a blind retry).
- **Confirmation requirement** follows directly from `kind`: `automatic` clears itself
  with no confirmation; `confirm-required` clears after one closed-choice confirmation;
  `owner-decision` and `unsafe-manual` require the owner to act (differ in *what*
  resolves them — a decision vs. a manual repair — not in whether confirmation is
  needed).
- **Excluded from every fingerprint tier** (D7) — it is operational state, like `status`.

**Terminal vs. dependency-satisfying vs. successful** (unchanged from the original
draft, still required):

| Status | Terminal? | Satisfies `depends_on`? | "Successful"? |
|---|---|---|---|
| `implemented` | yes | yes | yes |
| `verified` | yes | yes | yes |
| `archived` | yes | yes (inherited from the task's prior terminal state) | yes |
| `abandoned` | yes | **no** (task 01 changes `depsSatisfied` to exclude it) | no |
| `superseded` (if kept) | yes | **no** — a dependent must point at the superseding task instead | no |

**Fingerprint tiers (D7, replaces the single-hash approach entirely):**

| Tier | Computed by | Covers | Recorded in |
|---|---|---|---|
| Change-level | `computeChangeFingerprint(change)` | change scope, shared constraints, owner decisions, change-level acceptance criteria, task graph (ids + `depends_on` shape), cross-task invariants, shared context rules | `reviews/spec.md`'s `change_fingerprint` |
| Task-level | `computeTaskFingerprint(change, taskId)` | that task's own definition, acceptance criteria, `allowed_paths`/`consequential_paths`/`forbidden_paths`, `context`, `semantic_references` (D18 — `dependency_contracts`, `decisions`, `constraints`), `context_exceptions` (D13) | `reviews/<task-id>.md`'s `task_fingerprint` |
| Implementation-review | `computeImplementationFingerprint(change, taskId)` | task-level fingerprint + reviewed diff/revision identifier + evidence references (command, exit code, file/line) | `reviews/<task-id>.md`'s `implementation_fingerprint` |

None of the three ever includes `status` or `execution.suspension` for any task.

**Task semantic references (D18, second refinement pass) — deterministic, not
prose-inferred.** A task's fingerprint-relevant dependency/decision/constraint inputs are
declared explicitly, not derived from reading the task's own text:

```yaml
# in a task's front matter, optional (absent, or all three lists empty, is valid)
semantic_references:
  decisions: [D7, D13]              # owner-decisions.md entries this task's content depends on
  constraints: [C2]                 # named shared constraints (see "Constraints" above, referenced by position)
  dependency_contracts: [task-a]    # subset of depends_on whose scope this task actually relies on
```

- `dependency_contracts` must be a subset of the task's own `depends_on` — a
  `validate` error names any entry that isn't. A task may list more entries in
  `depends_on` than in `dependency_contracts`: `depends_on` alone can express pure
  *ordering* ("runs after"), while `dependency_contracts` is only the subset whose scope
  is actually load-bearing for this task's own fingerprint.
- `decisions`/`constraints` entries must resolve (a `validate` error names an
  unresolvable one) — same enforcement pattern as `context_exceptions[].decision` (D13).
- This replaces "the subset of `depends_on` whose target's scope the task actually
  relies on" (D7's original, prose phrasing) with a checkable fact — the *intent* is
  unchanged, only how tooling determines it.
- **Integrity vs. completeness (D26, third refinement pass).** The checks above are
  reference *integrity* — does a listed entry exist, is it active rather than superseded,
  are there duplicates — and stay fully deterministic (`validateSpecs`). They cannot
  detect *completeness* — whether the list actually covers everything the task's goal,
  constraints, acceptance criteria, context, and path rules depend on. That gap is closed
  by an explicit model-review step inside `/nevo-ai:spec-review` (documented and wired by
  task 11, since task 01 cannot touch `.claude/commands/**`/`.claude/skills/**`), not by
  schema validation — see `owner-decisions.md` D26.

**Invalidation matrix (required by the refinement, now explicit, restated in terms of
`semantic_references`):**

| Change | Invalidates change-level fingerprint? | Invalidates task-level fingerprint of task T? |
|---|---|---|
| Task T's `status` changes | No | No |
| Task U's `status` changes (U ≠ T) | No | No |
| A new, unrelated task is added | No (task graph shape unchanged for existing tasks' own `depends_on`) | No, unless T's `semantic_references.dependency_contracts` includes the new task |
| Shared scope/constraint text changes | Yes | Yes, only for tasks whose `semantic_references.constraints` names that constraint |
| Task T's acceptance criteria change | No (task-scoped) | Yes |
| Task U's acceptance criteria change (U ≠ T) | No | No, unless T's `semantic_references.dependency_contracts` includes U |
| An owner decision referenced by task T's `semantic_references.decisions` changes | No, unless the decision is change-level | Yes, for every task referencing it |
| An owner decision is superseded by a later one (see below) | No, unless the decision is change-level | Yes, for every task whose `semantic_references.decisions` names the superseded decision — the fingerprint is computed against the currently-active decision, not the superseded one |
| A mechanical/resolver task is added, depending on an already-approved task | No | No, for every task not naming the new task in `semantic_references.dependency_contracts` |
| The dependency graph changes task T's prerequisites or their ordering semantics | Yes (task graph shape) | Yes, for T |
| Task T's `context_exceptions` changes | No | Yes (D13 — exceptions are semantic) |
| Task T's `semantic_references` block itself changes (a reference is added/removed) | No | Yes — the fingerprint's own input set changed |

**Owner-decision supersession.** Most "Refined by" pointers in `owner-decisions.md`
narrow or extend an earlier decision without replacing it (e.g. D2 "Refined by: D8" —
D2's stop-condition list is still fully in force; D8 only changed how a stop is
represented in state) — both entries stay independently hashable and a task may
correctly reference either. A `Refined by` note only marks **supersession** when its own
text says so explicitly (e.g. D1: "kept for the audit trail; D7 is authoritative on
granularity"). `validateSpecs` parses that explicit marker and rejects a
`semantic_references.decisions` entry that names a decision superseded on the exact
question a task cites it for, naming the superseding decision it should reference
instead — so a task's fingerprint always hashes the currently-active decision text, and
a superseded decision is never hashed as if it were still simultaneously binding.

### Recovery model

**Canonical scenario set — nine, not eight**, each with a stable identifier (area
`recovery-and-resume` owns the full table with error class/code/recoverability/
confirmation/proposed-recovery/suspension/retry-target/stop-condition/post-recovery
status for every one):

`REC-01 WRONG_BRANCH` · `REC-02 REMOTE_BRANCH_ONLY` · `REC-03 STALE_GENERATED_FILE` ·
`REC-04 MECHANICAL_VALIDATION_FAILURE` · `REC-05 DIRTY_WORKTREE_TASK_FILES` ·
`REC-06 DIRTY_WORKTREE_UNRELATED_FILES` · `REC-07 STALE_REVIEW_AFTER_SEMANTIC_CHANGE` ·
`REC-08 SCOPE_EXPANSION` · `REC-09 ADR_CONFLICT`.

Tests and acceptance criteria reference these identifiers, never a prose count.

**Recovery is defined through action postconditions, not status transitions alone.**
Every state-changing controller action (`approve`, `start`, `complete`, `verify`,
`finalize`, and the new batch/suspension operations) gets an explicit contract:
preconditions, intended side effects, a completion postcondition (a checkable predicate
over real state — branch, status, suspension, context — not "the command returned 0"),
safe partial states, a recovery procedure that inspects postconditions and executes only
the missing effects, and explicit retry-safety terminology:

- **`completed`** — every postcondition holds; nothing to do.
- **`safe_to_retry`** — repeating the action is harmless even if partially applied
  (replaces the ambiguous use of "idempotent" for this purpose — the codebase's existing
  `validateTransition` `idempotent` flag is a narrower, still-correct concept: "already
  at the target status," which this model treats as one specific case of `completed`,
  not renamed).
- **`partially_completed`** — some but not all effects happened (e.g. `start` created and
  checked out the branch but never reached the status write); recovery executes only the
  missing effects, never repeats a completed one.
- **`not_retryable`** — the original action's preconditions no longer hold (e.g. the task
  was un-approved, or its dependencies changed) — this becomes a *new* suspension, not a
  blind retry of the old one.
- **`unsafe_manual`** (D17, second refinement pass) — the postcondition inspection maps
  1:1 onto `execution.suspension.kind: unsafe-manual`: the situation cannot be resolved
  by a closed-choice confirmation or an automatic repair, and requires the owner to act
  manually outside the controller's retry loop (e.g. an unresolvable merge conflict in a
  repair, or a `REC-09` ADR conflict). Distinct from `not_retryable`: a `not_retryable`
  result means the *original action's own preconditions* changed and a **new**
  suspension replaces the old one automatically; `unsafe_manual` means no automated or
  confirmed path back exists at all — the controller stops and waits, it does not create
  a follow-on suspension of a different kind on the owner's behalf.

Five result-class values total —
`completed`/`safe_to_retry`/`partially_completed`/`not_retryable`/`unsafe_manual` — cover
every postcondition-inspection outcome; no new-code comment or doc text describes any of
them as "idempotent" (that term keeps its narrower, pre-existing `validateTransition`
meaning).

**Batch hard stops are not part of this model (D24, third refinement pass).** A failed or
unresolved self-check, a failed acceptance criterion, failed automated verification, or
an implementation error preventing verification are not `REC-xx` scenarios and do not
produce an `execution.suspension` — they are the implementation not yet satisfying its
own verification, not a tool/workflow-state error this postcondition model reasons about.
See "Batch execution model" below for the hard-stop-vs-risk-signal split this
distinction feeds.

**Repair-and-retry inside an authorized combined transition (D17).** A `confirm-required`
stop that occurs *inside* an owner-already-authorized combined transition (D3's "approve
and start," and any other combined transition this change introduces) does not end that
transition's authorized loop — it resumes it. Concretely, for `approve` → `start`:

```text
approve
  → inspect
  → start
  → inspect
```

If `approve` succeeds and `start`'s postcondition inspection reports
`confirm-required` (a recoverable issue the owner must confirm, not decide), the
controller: (1) preserves the already-succeeded `approve`; (2) presents the recovery
action for confirmation; (3) on confirmation, performs the repair; (4) re-inspects
`start`'s postconditions; (5) executes only the still-missing postconditions; (6)
continues the same authorized sequence to completion. The owner is never asked to
re-invoke `/nevo-ai:task-start` for a repair they already confirmed inside the combined
flow. The loop stops — ending the authorized sequence rather than resuming it — for any
of: unresolved partial completion the owner hasn't yet confirmed a repair for, an
`unsafe_manual` result, unrelated dirty files (`REC-06`), scope expansion (`REC-08`), an
ADR conflict (`REC-09`), a `not_retryable` result (preconditions changed — this becomes a
fresh, separately-presented suspension, not a silent continuation), or a failed
acceptance criterion.

Regression coverage (task 04): approval succeeds, a branch-repair confirmation resumes
`start` without repeating the approval step; approval succeeds but `start` becomes
`not_retryable`, and the approval stays persisted while the workflow stops and reports
why; a `partially_completed` `start` executes only its missing postconditions on resume,
never repeating a completed effect.

Example — `start-task`:

- **Preconditions:** task `status == approved`, `depsSatisfied`, working tree clean.
- **Effects:** create/checkout branch, load context packet, write `status =
  in-implementation`.
- **Completion postcondition:** current branch equals the expected task/change branch,
  `status == in-implementation`, no unresolved `execution.suspension` for this task, the
  context packet was produced.
- **Recovery:** inspect each postcondition; if the branch exists and is checked out but
  `status` wasn't written, write only that; if the branch doesn't exist, create it; never
  re-run `git checkout -b` against a branch that already exists (that's a `REC-02`-class
  situation, not a retry).

### Interaction model

Unchanged from the original draft in intent (D2, D3) — refined only in what state it
reads:

- `deriveStage`, now suspension-aware (a task with an active `execution.suspension`
  reports that instead of its stage's usual `nextCommand`), remains the single planning
  input every conversational command consults.
- `spec-review` reaching `ready-for-approval` offers approval inline.
- `spec-approve`'s fourth outcome, "approve and start" (D3), performs `approve`, then
  re-checks `start`'s guards against *current* state, then `start` — using the postcondition
  model above for the re-check, not a bare boolean. On a `start` failure, the task's
  `status` stays `approved` (never rolled back, never silently re-approved); if the
  failure is `partially_completed`, an `execution.suspension` (`previous_action: start`)
  is recorded so a later retry only performs the missing effects; if the failure is
  `confirm-required`, D17's repair-and-retry loop resumes `start` after one confirmation
  instead of ending the combined flow (see "Recovery model" above).
- `task-review` reaching a fully-terminal change offers to archive inline; under an
  active batch, it offers to continue to the next batch task inline.

**Expansive continuation boundary (D2, reinforced by both refinement passes):** an
authorized scope is always one of the four batch-selection modes (D20 —
`currently-ready` / `all-approved-reachable` / `named-subset` / `until-checkpoint`) or a
single named task. Inside that scope, the controller may continue through
`completed`/`safe_to_retry`-resolved recoveries automatically, and — per D17 — through a
`confirm-required` recovery once the owner has confirmed it in place, without ending the
authorized loop. It must stop immediately for: implicit scope expansion (`REC-08`), an
architectural/behavioral decision, an `unsafe_manual` result (D17), unrelated dirty files
(`REC-06`), a `not_retryable` result (D17 — a fresh suspension is presented, the loop
does not silently continue past it), a failed acceptance criterion, an unexpected
public-contract impact, unresolved high-risk evidence (D11), stale unresolved batch
evidence (D19), or the end of the authorized scope — never past it, regardless of how
"safe" the next step looks.

### Batch execution model

- **Selection has four named modes, no default (D20, second refinement pass):**

  | Mode | Selects |
  |---|---|
  | `currently-ready` | Only tasks `next`-ready at planning time (the previous implicit default). |
  | `all-approved-reachable` | Every approved task that will become ready once earlier-selected tasks complete — computed as a deterministic topological order; excludes anything blocked by an unselected prerequisite or an unresolved owner decision. This is what makes "execute all approved reachable tasks, one gating review at the end" expressible for a linear dependency chain, where `currently-ready` alone would only ever select the first task. |
  | `named-subset` | An explicit task-id list; validated for closure over required dependencies — reports missing prerequisites rather than silently including or excluding them. |
  | `until-checkpoint` | The reachable sequence, executed until a named checkpoint or stop condition is hit. |

  Ordering within any selected mode follows the existing `depends_on`/`next` logic
  exactly; an unsatisfiable batch is rejected before any task starts.
- Single-active-task constraint: unchanged from the original draft.
- **Batch state is derived, not duplicated (D10).** The only persisted batch file holds
  intent: `change`, `requestedTasks`, `orderedTasks`, `startRevision`, `reviewMode`,
  `checkpointPolicy`, `temporaryInconsistencies`. Completed/current/next/failed are
  always computed from `change.yaml` task status plus `execution.suspension` — there is
  no second copy of progress to reconcile after a crash.
- **Hard stop conditions are separate from full-review risk signals, and evaluated first
  (D24, third refinement pass).** A failed self-check, an unresolved self-check, a failed
  acceptance criterion, failed automated verification, stale evidence that cannot be
  refreshed (D19), missing required evidence, or an implementation error preventing
  verification all **stop the batch immediately** — a full `task-review` can never
  substitute for one of these; it is a risk judgment, not a repair mechanism. On a hard
  stop: preserve the current task/batch state, report the failed criterion or evidence,
  require the implementation to be corrected, rerun the self-check, and continue only
  once it passes. Only *after* the self-check passes do the risk signals below determine
  whether a full `task-review` is additionally required.
- **Risk classification is evidence-based, not path-touch-based (D11, corrected by D24 to
  exclude the self-check signal — see above).** See `owner-decisions.md` D11 for the full
  signal list (public-API/compatibility impact, security/authorization impact,
  migration/destructive-persistence behavior, an `owner-decision:`-tagged criterion,
  scope expansion, unexpected files, implementation divergence, an owner-flagged
  high-risk task, or inspection-only evidence where model review is explicitly
  required). A small, low-risk code task meeting none of these — and with no hard-stop
  condition — is eligible for self-check plus the end-of-batch gating review only.
- **Evidence freshness is checked before the gating review runs (D19, second refinement
  pass).** A task passing its self-check earlier in the batch does not mean that
  evidence is still trustworthy by the time the gating review runs if a later batched
  task touched the same subsystem. Immediately before the gating batch review: (1)
  determine which later-batched tasks' changes could affect an earlier task's recorded
  evidence; (2) rerun any automated verification command whose target files changed
  since it last ran; (3) invalidate (and require a refresh of) any inspection-type
  evidence whose referenced files/line ranges changed since it was recorded; (4) treat
  evidence for a task whose own semantic fingerprint (D18) has changed since the
  evidence was recorded as stale regardless of file-level overlap. The gating review does
  not proceed while any batched task carries stale, unrefreshed evidence. Evidence stays
  compact — a revision/content-hash identifier plus a file/path reference list plus (for
  automated evidence) the command identity — never full command output or full diffs.
  Owner-recorded evidence stays valid as long as the task's semantic fingerprint is
  unchanged; an operational status change alone does not stale it.
- **Responsibility split**, made explicit per the refinement's request:

  | Layer | Scope | Re-checks acceptance criteria? |
  |---|---|---|
  | Task self-check | One task's own `Verification` commands | Yes, for that task only |
  | Full task review | One risky task's diff, per `review-policy.md` | Yes, in depth |
  | Evidence freshness check (D19) | Whether earlier-recorded evidence in the batch is still current | N/A — refreshes/reruns evidence, does not itself judge acceptance criteria |
  | Gating batch review | The whole batch's diff since `startRevision`, cross-task integration, open follow-ups | No — trusts each task's own self-check/review (once evidence-freshness-checked); checks integration, not re-litigates individual criteria |
  | Advisory change-wide audit (`spec-audit`) | One named cross-cutting lens across an already-implemented change | No — never re-evaluates task acceptance criteria (unchanged, pre-existing rule) |

  No layer re-reviews the same semantic content in full twice.
- Temporary inconsistency: unchanged from the original draft — declared between two
  named tasks, visible in the batch intent file, `validate`/`check` skipped only for that
  declared pair.
- **Task dependency (D21, second refinement pass):** `batch-execution-and-gating-review`
  (task 08) depends on `scope-and-follow-up-mechanisms` (task 06) — the gating batch
  review reads open blocking follow-up entries, a mechanism task 06 introduces. A
  dependency on `mechanical-task-type` (task 07) was evaluated and found unnecessary: a
  `type: mechanical` task is ordinary from batch execution's perspective (D14 requirement
  21), so task 08 has no code path that needs task 07's contract specifically.

### Validation and evidence model

- **Context routing has a stable, machine-readable contract (D12).** `task-routing.md`/
  `change-impact-map.md` gain a fixed-column table (`rule_id | path_glob | doc_ref`),
  validated by `tools/docs.mjs validate`; `tools/docs.mjs generate` emits
  `docs/routing.generated.json`, which is the only thing the context-completeness check
  ever reads — never free prose.
- **Context exceptions require an owner-decision reference and affect the fingerprint
  (D13):** `context_exceptions: [{omitted, decision, reason}]`, `decision` must resolve
  in `owner-decisions.md`; included in the task-level semantic fingerprint.
- Consequential/mechanical paths and structured acceptance-criteria evidence tags:
  unchanged from the original draft.
- **Follow-up ledger is a mutable current-state list, stored as structured YAML (D15,
  D22).** `follow-ups.yaml` (not `follow-ups.md` — D22, second refinement pass, replaces
  the Markdown-prose format with a schema-validated YAML list, since a Markdown table
  would need its own versioned micro-format to be reliably parseable and YAML already
  does that job). See `owner-decisions.md` D15/D22 for valid statuses, dismissal rules,
  and severity-to-gate mapping (task completion / batch review / finalization).
- **Mechanical task approval is "review-exempt deterministic approval" (D14)** — an
  explicit `approve` transition still occurs; only the review-file requirement is
  exempted, and only when every classifier condition holds. It fails closed to the
  normal review-then-approve cycle otherwise.

### Token and complexity budget

| Mechanism | Expected token effect | Added complexity | This change? |
|---|---|---|---|
| Three-tier fingerprint + invalidation matrix (D7) | Granular invalidation vs. the original single-hash approach — avoids full spec re-review for a status change, an unrelated task, or a mechanical resolver, closing the exact gap the refinement found in the original fix | Medium — three projection functions instead of one whole-file hash, but each is simpler (semantic fields only, no exclusion list to maintain) | Yes |
| `execution.suspension` vs. new statuses (D8) | Avoids re-deriving "what were we doing" from scratch after interruption — the retry target is stored, not re-inferred | Low — one optional block, no new transition table rows | Yes |
| Derived batch progress (D10) | Removes reconciliation-after-crash reasoning entirely — there is nothing to reconcile | Lower than the original two-file design, not higher | Yes |
| Evidence-based batch risk model (D11) | This is the actual token-saving mechanism for batch mode — without it, nearly every code task would need a full review, and batch mode would save nothing over one-task-at-a-time | Low — a signal list, not a new subsystem | Yes |
| Validated routing table + generated index (D12) | Avoids re-parsing prose on every context check; a JSON read replaces a Markdown interpretation | Low — reuses the existing generate/validate pattern already in `tools/docs.mjs` | Yes |
| Postcondition-based recovery (D4/D8) | Avoids re-explaining a known partial-success state to the owner; recovery executes only missing effects instead of a human re-diagnosing from scratch | Medium — one contract per state-changing action, but each is small | Yes |
| One controller loop vs. separate command turns (D2/D3) | Largest reduction for batch/expansive scopes: N interruptions collapse toward one authorization + inline offers | Medium — already scoped in tasks 03/04/08 | Yes |
| Repair-and-retry inside combined transitions (D17) | Removes a second command invocation the owner would otherwise need after confirming an in-flight repair — closes a gap the second refinement pass found between D2/D3's "one confirmation" intent and D8's postcondition model | Low — reuses the existing postcondition/suspension machinery, adds one result value (`unsafe_manual`) and a resume-in-place branch | Yes |
| Deterministic `semantic_references` (D18) | Removes prose-inference from fingerprint scope determination — avoids both under- and over-invalidation an implementation would otherwise have to guess at | Low — one optional schema block per task, validated the same way `context_exceptions` already is | Yes |
| Evidence-freshness check before gating review (D19) | Prevents the exact regression the second refinement pass identified (a later task invalidating an earlier task's trusted evidence) without falling back to full re-review of every task | Medium — a staleness computation over files/commands/fingerprints, run once per batch, not per task | Yes |
| Four-mode batch selection (D20) | Makes "run everything approved and reachable" expressible in one authorization instead of requiring N single-task batches for a linear dependency chain | Low — a named-mode dispatch over logic the batch controller already needs | Yes |
| Structured `follow-ups.yaml` (D22) | Avoids Markdown-table parsing/versioning risk this repository's own `references/review-policy.md` implicitly warns against — a JSON/YAML read replaces a prose-table interpretation | Low — same generate/validate-adjacent pattern already used elsewhere in this change | Yes |
| Hard-stop/risk-signal split for batch self-check (D24) | Avoids the token cost of a full `task-review` being triggered for what is actually a correctness bug, not a risk judgment — the fix is cheaper (correct the code, rerun self-check) than the review it was wrongly routed to | Low — reclassifies one existing signal, no new subsystem | Yes |
| Ordered, truthful repair-branch guards (D25) | No direct token effect — this is a correctness/honesty fix to an already-planned mechanism (D23), not a new one | Low — reordering four existing checks into a nine-step sequence, no new guard logic | Yes |
| Semantic-reference completeness model review (D26) | Adds one model-review pass per spec review, but only for tasks declaring `semantic_references` — cheaper than the alternative (a silently-stale fingerprint causing a missed regression, caught much later at higher cost) | Low — one more inspection step inside an already-model-driven review, no new subsystem | Yes |
| Full workflow engine / generic state DSL | N/A — explicitly rejected | High | No |
| Parallel task execution | N/A — explicitly rejected | High, unsafe for shared `change.yaml` | No |

Compared to the original (pre-refinement) budget table: the fingerprint and batch-state
rows are *more* expensive to implement than first proposed (three functions instead of
one; a signal-based risk model instead of a path check) but correspondingly close real
gaps the simpler versions would have reproduced under a different trigger — the
refinement's own framing ("optimize for less repeated model reasoning and smaller
context, not fewer commands") is the reason the more granular versions are worth the
extra implementation cost.

## Compatibility and migration

- Existing `change.yaml` files need no structural migration for the status/transition
  model (unchanged) but do gain new optional fields (`execution.suspension`,
  `context_exceptions`, and — D18 — `semantic_references`) — additive, absent by
  default. A task file with no `semantic_references` block (or an empty one) is fully
  valid: it simply means `computeTaskFingerprint` treats that task as referencing
  nothing beyond its own content, so existing task files remain valid without edits.
  They don't benefit from `semantic_references`' granular invalidation until reviewed
  and annotated — task 01 documents this as a recommended, not required, follow-up
  review pass for existing active changes once this change ships.
- Any `reviews/*.md` with the old single `spec_fingerprint` becomes stale the moment this
  change ships (expected one-time re-review, same as the original D1 plan, now scoped
  per-tier under D7).
- `allowed_paths`/`context.required`/acceptance-criteria additions remain additive,
  optional front-matter fields.
- `blocked`/`needs-decision` are **removed outright (D16)**, not left unreachable — any
  existing `change.yaml` (task- or change-level `status`) currently set to either value
  fails `validate` with the fixed migration message (`` Status `blocked` is no longer
  supported. Use `execution.suspension`. ``) the first time this change ships. This is
  the intended one-time migration signal, not a regression — no currently-active change
  in this repository has either status set today (verified during discovery), so this is
  not expected to require a real fix anywhere on ship day, only to guard against it going
  forward.
- `follow-ups.md` becomes `follow-ups.yaml` (D22) — any change with an existing
  `follow-ups.md` (none exists in any currently-active change, verified during
  discovery) would need a one-time hand or scripted conversion to the new schema before
  this change ships; task 06 documents the conversion shape.
- Manual, single-step `tools/specs.mjs` commands and `.claude/commands/nevo-ai/*.md`
  entry points remain available throughout.

## Areas

- `areas/state-and-fingerprint-semantics.md` — task 01
- `areas/recovery-and-resume.md` — tasks 02, 03
- `areas/conversational-continuity.md` — task 04
- `areas/context-and-validation-hardening.md` — tasks 05, 06, 07
- `areas/batch-execution-and-gating-review.md` — task 08
- `areas/finalization-and-migration.md` — tasks 09, 10, 11

## Change-wide acceptance criteria

1. The three fingerprint tiers (D7) are computed as canonical semantic projections, not
   whole-file hashes with an exclusion list; a test proves every row of the invalidation
   matrix above.
2. `depsSatisfied` excludes `abandoned`.
3. No task's `execution.suspension` ever implies a different `status` than the task's own
   real lifecycle position; a test proves a suspended task's `status` is unchanged by
   entering or clearing a suspension.
4. All nine `REC-01`..`REC-09` scenarios are classified with a stable code, a
   `completed`/`safe_to_retry`/`partially_completed`/`not_retryable`/`unsafe_manual`
   postcondition contract for the action involved, and a defined suspension/retry/stop
   behavior.
5. `spec-approve`'s "approve and start" outcome re-checks `start`'s postconditions before
   running it, and a `start` failure leaves `status: approved` with, if applicable, a
   `partially_completed` suspension — never a rollback, never a silent re-approval; a
   `confirm-required` `start` failure resumes the same authorized combined flow after one
   confirmation, never forcing a second `/nevo-ai:task-start` invocation (D17).
6. Batch execution derives all progress from `change.yaml`; a test proves an interrupted
   batch reconstructs correctly with no separate progress file to reconcile.
7. A small, low-risk batched task (approved scope, no public-contract change, complete
   automated verification, no new decision, no unresolved findings) completes via
   self-check plus the end-of-batch gating review only — no mandatory full `task-review`.
8. `context_exceptions` entries resolve to a real `owner-decisions.md` entry and are
   included in the task-level fingerprint; an unresolvable `decision` reference is a
   `validate` error.
9. `spec-finalize` does not delete the PR's branch until the post-merge check has run;
   on failure, it reports the merged SHA, the failed check, and the exact recovery
   command, and writes nothing into the archived change.
10. The context-routing check reads only `docs/routing.generated.json`, never re-parses
    `task-routing.md`/`change-impact-map.md` prose at check time.
11. `follow-ups.yaml` entries are mutated in place (no "append-only" behavior); a
    `blocking`-severity entry cannot be dismissed without an owner decision.
12. `type: mechanical` still performs an explicit `approve` transition (visible in
    `change.yaml`) and fails closed — never silently blocks with no path forward — when
    any classifier condition doesn't hold.
13. `node --test tools/tests/` covers every regression scenario listed in the first
    refinement request's "Required regression scenarios" section and the second
    refinement request's "Required regression tests" section (fingerprints, recovery,
    combined transitions, batch, context/follow-ups, finalization — see tasks 01-04,
    06, 08-10 for the per-area subset each owns).
14. Manually setting a task's or the change's `status` to `blocked` or `needs-decision`
    fails `validate` with the fixed migration message naming `execution.suspension` as
    the replacement (D16).
15. Every task file's `semantic_references.dependency_contracts` is a subset of its own
    `depends_on`, and every `semantic_references.decisions`/`constraints` entry
    resolves; an invalid reference is a `validate` error (D18).
16. The gating batch review does not run while any batched task carries evidence that is
    stale under the freshness rules (file/command/fingerprint-based); a test proves a
    later task invalidating an earlier task's evidence is detected and either refreshed
    or blocks the review (D19).
17. Batch selection supports all four named modes (`currently-ready` /
    `all-approved-reachable` / `named-subset` / `until-checkpoint`); a test proves
    `all-approved-reachable` selects a full linear approved chain that `currently-ready`
    alone could not (D20).
18. `spec-finalize`'s post-merge repair path creates the repair branch only after an
    explicit owner confirmation and only once the ordered nine-step guard sequence
    (D25) passes: worktree clean → local repair branch absent → `git fetch origin` →
    remote repair branch absent → `origin/main` matches the recorded failing SHA →
    switch to local `main` → `git pull --ff-only` → local `main` matches the recorded
    failing SHA → create the branch. A guard failure before the `main` switch (steps
    1/2/4/5) leaves no local state changed except a possible read-only fetch, reported
    as such; a guard failure after the switch (step 8) leaves no repair branch created
    but explicitly reports that `main` was switched to and/or fast-forwarded — the
    report never claims the repository is unchanged when it isn't (D23).
19. `batch-execution-and-gating-review` (task 08) lists `scope-and-follow-up-mechanisms`
    (task 06) in `change.yaml`'s `depends_on` (D21).
20. A failed or unresolved self-check stops the batch immediately and cannot be
    completed by routing to a full `task-review` instead; the batch resumes only after
    the implementation is corrected and the self-check passes, at which point the
    (self-check-excluding) risk signals determine whether a full `task-review` is still
    required (D24).
21. Every task's `semantic_references` block is checked for completeness — not just
    reference integrity — as an explicit model-review step inside
    `/nevo-ai:spec-review`; a missing reference the task's content actually relies on is
    reported as a finding, categorized per the normal `AUTO_FIX`/`OWNER_DECISION`/
    `NON_BLOCKING` rules (D26).

## Verification strategy

`node --test tools/tests/` (new and existing suites), `node tools/specs.mjs validate` /
`check`, `node tools/docs.mjs validate` / `check`, and a dogfooding pass once
implementation begins (not part of this specification step).

## ADR impact

Unchanged in intent from the original draft: a new ADR is recommended (number assigned at
write time, folded into task 11) capturing why fingerprints are tiered rather than
whole-file (D7), why recoverable stops use `execution.suspension` rather than new
lifecycle statuses (D8), why `approve`+`start` gained a combined-confirmation exception
(D3), why batch execution is sequential-only with derived progress (D2/D10), and why
post-merge failure defers branch deletion rather than mutating an archived change (D9).
The second refinement pass adds: why `blocked`/`needs-decision` are removed outright
rather than left unreachable (D16), why a `confirm-required` recovery resumes an
authorized combined transition in place instead of ending it (D17), why the task-level
fingerprint's dependency scope is an explicit `semantic_references` block rather than
inferred from `depends_on` (D18), why the gating batch review requires an
evidence-freshness check (D19), why batch selection has four named modes (D20), and why
the preserved post-merge branch is a "diagnostic anchor" with a guarded, confirm-then-
create repair-branch step rather than either a full recovery mechanism or a report-only
one (D23). The third refinement pass adds: why a failed self-check is a hard batch stop
that a full `task-review` cannot substitute for, rather than one more risk signal that
routes to review (D24); why the repair-branch guards are ordered to front-load every
read-only/remote check before any local mutation, and why the failure contract reports
already-occurred fetches/switches instead of claiming no modification occurred (D25);
and why `semantic_references` completeness is a model-review step inside
`/nevo-ai:spec-review`, layered on top of — not a replacement for — `validateSpecs`'s
deterministic reference-integrity checks (D26). No existing ADR is superseded.

## Out of scope

- A general-purpose workflow engine or state-machine DSL.
- Parallel task execution or any concurrent write path to `change.yaml`.
- Using the mechanical task type to bypass an architectural, API, or behavior decision.
- New external infrastructure (databases, queues, hosted workflow services).
- Removing or renaming any existing `/nevo-ai:*` command or `tools/specs.mjs` subcommand.
- Making batch execution or auto-continue the default behavior for a single ad hoc task.
- Making `blocked`/`needs-decision` reachable lifecycle statuses (explicitly reversed by
  D8) — or retaining them as valid-but-unreachable vocabulary at all (explicitly removed
  by D16).
- An event-sourced or history-preserving follow-up ledger (explicitly reversed by D15 —
  git history is sufficient).
- Automating any part of a post-merge repair beyond creating the guarded repair branch —
  editing files, running the targeted checks, and opening the repair PR remain manual,
  owner-driven steps (D23).
- Letting a full `task-review` substitute for a failed or unresolved self-check inside a
  batch — a hard stop always requires the implementation to be corrected first
  (explicitly closed by D24).
- Any `git reset`, `git clean`, force-checkout, or automatic stash inside the post-merge
  repair-branch flow (explicitly excluded by D25).
- Treating `semantic_references` reference-integrity validation as sufficient proof of
  completeness — a model-review step is required in addition, not instead (D26).
