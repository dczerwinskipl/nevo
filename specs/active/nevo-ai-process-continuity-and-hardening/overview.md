---
id: spec.nevo-ai-process-continuity-and-hardening
type: change
title: NEvo AI workflow process continuity and hardening
status: draft
change: nevo-ai-process-continuity-and-hardening
---

# NEvo AI workflow process continuity and hardening

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
and the skill references, as of this change's discovery pass.

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
reachable today only by hand-editing `change.yaml`. `superseded` exists only in
`service.mjs:163-166`'s `STATUS_ORDER`, used solely to sort the generated Markdown index;
it is not in `TERMINAL_STATUSES`, not in `TRANSITIONS`, and no code ever sets it.

### States (change-level)

`ACTIVE_CHANGE_STATUSES = {approved, in-implementation, needs-decision, draft, blocked}`
(`lifecycle.mjs:9`). `validateSpecs()` (`validation.mjs:8-64`) checks only that
`change.status` is *present* — there is no enum/allowlist check on its value.

### Persisted vs. derived state

Persisted: `change.yaml` (change/task status, `depends_on`, `branch`, task file
pointers), task/area/overview front matter and body, `reviews/*.md` (verdict, resolved
counts, `spec_fingerprint`), `audit_status` on audit reviews.

Derived, recomputed on demand, never stored: `depsSatisfied`/`isTaskReady`
(`lifecycle.mjs:11-21`), `computeSpecFingerprint` (`service.mjs:128-153`),
`validateFinalize`'s gate facts (`lifecycle.mjs:131-191`), and `deriveStage`
(`lifecycle.mjs:207-284`) — a single, tested, pure "where are we / what's next" classifier
already exists and is not duplicated elsewhere in `tools/specs.mjs` itself.

### Fingerprint (confirmed defect)

`computeSpecFingerprint` (`service.mjs:128-153`) hashes the **raw bytes** of
`change.yaml` plus every `overview.md`/`owner-decisions.md`/area/task file — not
extracted content fields. Because `change.yaml` carries every task's `status` inline, any
task's status transition changes the hash for the *entire change*, invalidating the
`spec_fingerprint` embedded in a review for a completely unrelated task
(`validateApproval`, `lifecycle.mjs:100-106`, compares that stored value against the
freshly recomputed one). No existing test exercises this cross-task scenario — only
content-file sensitivity is tested (`tools/tests/fingerprint.test.mjs:47-61`).

### Recovery and errors

Every failure is a `CliError` (or uncaught exception) caught once, at the top of
`runCli` (`tools/specs.mjs:440-452`), printed, `process.exitCode = 1`. No error
classification, no machine-readable codes, no retry logic anywhere in `tools/specs.mjs`,
`lifecycle.mjs`, or `tools/lib/git.mjs`. `handleStart` (`tools/specs.mjs:135-168`)
persists `in-implementation` **after** branch creation/checkout (line 163, after lines
152-158) — not before any action at all, but before any real file edit, so a session that
ends right after `start` leaves a task "in progress" with an empty diff. `branchExists`
(`tools/lib/git.mjs:18-25`) checks only the local ref; a branch that exists on `origin`
but not locally is not detected, and `start` would create a diverging local branch from
current `HEAD` rather than checking out the remote one.

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
- `spec-approve.md` offers exactly three outcomes (approve / keep as draft / show report)
  and explicitly forbids combining approval with start (line 66) — a deliberate,
  documented design choice, not an oversight.
- `task-review.md` computes a next-task/archive recommendation via `tools/specs.mjs status`
  but explicitly defers acting on it ("Report it, do not act on it").
- No command supports running more than one task per invocation; `task-next.md` returns
  exactly one task and explicitly forbids starting it.
- `spec-finalize.md`'s gate (`validateFinalize`) is entirely pre-merge; nothing re-checks
  `main`'s state after the squash-merge completes.

### Context, scope, and validation

`tools/specs.mjs context` (`service.mjs:65-93`) echoes a task's declared
`context.required`/`optional`/`allowed_paths`/`forbidden_paths` verbatim — no derivation,
no completeness check against `docs/ai/task-routing.md` or
`docs/ai/change-impact-map.md` (both exist, both are prose-only conventions, never read
programmatically, no stated precedence rule between them and a task's own declared
context). `allowed_paths`/`forbidden_paths` are enforced only by instruction at
`task-review` time (`task-review.md`, step 4) — no script diffs `git diff` against them.
Acceptance criteria and "Verification" are two separate freeform prose sections in
`templates/task.md`; no structured per-criterion evidence field exists. No task-level
`type`/`kind` field exists anywhere in the schema. `validateSpecs()` never validates
`allowed_paths`, `forbidden_paths`, or acceptance-criteria content at all — only ids,
`depends_on` resolution/cycles, and `task.file` existence.

### Review, audit, and evidence

Review evidence is already reasonably compact and structured —
`templates/review-report.md` defines an `ID | Category | Lifecycle | Predicate | Finding
| Evidence | Location` table, and the one real review on disk
(`specs/active/nevo-documentation-architecture/reviews/spec.md`) confirms short,
paraphrased evidence rather than pasted command output. A review file is fully
overwritten on every run; a `NON_BLOCKING` finding not turned into a task by a human via
`spec-refine` does not persist anywhere else. `spec-audit` is explicitly non-gating and
never re-checks a task's own acceptance criteria — there is no gating batch/change-wide
integrity review anywhere in the current process, and no batch-execution support at all.

## Problem decomposition

| Area | Confirmed findings it resolves | Status |
|---|---|---|
| State & fingerprint semantics | #7 (fingerprint defect, confirmed with a code citation), #17 (`superseded` inert, confirmed), doc rule contradiction (new, found during this change's own discovery) | Real, verified |
| Recovery & resume | #13 (no error classification), #14 (no retry) | Real, verified |
| Conversational continuity & approval ergonomics | #15 (fragmented transitions), #16 (approve+start separation — confirmed deliberate, not a bug; relaxing it is an explicit reversal, see D3) | Real (15), deliberate reversal (16) |
| Batch execution & gating review | #10 (task success ≠ change integrity), #18/#19 (no batch model, audit is non-gating) | Real, verified, absent entirely |
| Context completeness & scope hardening | #1 (no completeness check), #2 (routing is prose-only), #3/#20 (scope strictly enforced by instruction only, no mechanical-path allowance, no task-kind field), #4 (no durable follow-up ledger), #6 (no structured verification metadata) | Real, verified |
| Finalization & migration | #23 (finalize is pre-merge only), fingerprint-scheme migration for the in-flight change | Real, verified |

### Findings rejected or already resolved (not turned into tasks)

- **#5** — review evidence is already compact and structured; no change needed beyond
  what task 06 adds for acceptance-criteria evidence specifically.
- **#8/#9** — source-of-truth precedence is already explicit in `AGENTS.md`; the concrete,
  verified gap is narrower: `docs/ai/specification-workflow.md:61` ("prefer the smaller
  class when uncertain") contradicts the signal table beneath it, which routes genuine
  ambiguity to **E** — fixed as part of task 10, not a new precedence system.
- **#11** — status is persisted after branch creation/checkout, not before any action;
  the residual risk (a session ending between branch creation and the first real edit) is
  handled by the recovery model (task 02), not a new "preparation phase" status.
- **#12** — the deterministic computation (`deriveStage`) already exists; only "act on it"
  is missing — handled by extending, not rebuilding, in task 03.
- **#17** (partial) — not "inconsistent," inert; `superseded` is fixed in task 01 rather
  than treated as a broad dependency-satisfaction redesign.
- **#22** — `tools/specs.mjs` itself has no duplicated next-step computation; the
  per-command prose in `.claude/commands/nevo-ai/*.md` is appropriately scoped to each
  command's own gate. No change proposed here beyond what task 03/04 already do.

## Constraints

- Keep the spec-anchored, human-led model (`AGENTS.md`, ADR-0002).
- No autonomous approval of architectural/scope/API/compatibility decisions — the
  `AGENTS.md` gate list is unchanged by this work.
- No destructive worktree operation without explicit confirmation.
- No implicit scope expansion — the mechanical/consequential-path allowance (task 06/07)
  is narrow and auditable, not a general license.
- Parallel task execution is not introduced; "batch" means sequential, one active task at
  a time.
- No external infrastructure (databases, queues, workflow engines).
- Avoid introducing many new persisted statuses — `blocked`/`needs-decision` already exist
  in the vocabulary and are reused rather than adding new ones (task 02).
- `tools/specs.mjs approve`'s own approval gate remains the sole enforcement point for
  `approved` — this change does not weaken it, only lets the conversational layer chain
  into `start` after it passes (D3).
- No implementation begins under this specification itself — this change only specifies.

## Affected modules

`tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`,
`tools/specs/validation.mjs`, `tools/lib/git.mjs`, `tools/lib/cli-errors.mjs`,
`tools/tests/*.test.mjs`, `.claude/commands/nevo-ai/*.md`,
`.claude/skills/nevo-ai-spec-workflow/**`, `docs/ai/specification-workflow.md`,
`AGENTS.md`, `CLAUDE.md` (Claude-specific pointers only, per its own scope rule). No
`src/**` package is touched.

## Options and trade-offs

Full option sets, evaluated per `docs/ai/specification-workflow.md` § "Solution option
analysis," were presented to and decided by the owner — see `owner-decisions.md` D1-D6.
Summary: fingerprint scope (D1, field-stripping chosen over a file split or no-op),
auto-continue scope (D2, expansive batch model chosen over conservative/moderate),
approve+start combination (D3, combined confirmation with guard re-check and no-rollback
chosen over strict separation), batch + mechanical task type (D4, build both now),
additive context/scope mechanisms (D5, all four included), cleanups (D6, all three
included).

## Owner decisions

See `owner-decisions.md` — D1 through D6, all recorded 2026-08-04.

## Proposed architecture

### State model

No task status is added or removed. `blocked` and `needs-decision` become reachable in
practice (task 02) as the machine-readable landing state for, respectively, an
owner-decision-required recovery and an ambiguous/unsafe recovery — reusing existing
vocabulary per the "avoid new persisted statuses" constraint. `superseded` is either wired
into `TERMINAL_STATUSES`-adjacent handling as a real, distinct
dependency-non-satisfying-but-terminal state, or removed from `STATUS_ORDER` if the
discovery in task 01 finds no real use case — task 01 decides which, with evidence, not
this document (see "terminal vs. dependency-satisfying" split below).

**Terminal vs. dependency-satisfying vs. successful** (finding #10/#17, addressed in task 01):

| Status | Terminal? | Satisfies `depends_on`? | "Successful"? |
|---|---|---|---|
| `implemented` | yes | yes | yes |
| `verified` | yes | yes | yes |
| `archived` | yes | yes (inherited from the task's prior terminal state) | yes |
| `abandoned` | yes | **no** (task 01 changes `depsSatisfied` to exclude it) | no |
| `superseded` (if kept) | yes | **no** — a dependent must point at the superseding task instead | no |

This is a real change to `depsSatisfied` (`lifecycle.mjs:11-17`), currently treats all
four `TERMINAL_STATUSES` as equally dependency-satisfying, which is the concrete
inconsistency in finding #17: `abandoned` should not silently satisfy a downstream task's
dependency.

**Semantic vs. operational fingerprint fields** (D1, task 01): `status` (change-level and
per task) is excluded from `computeSpecFingerprint`'s hashed content; every other field
(title, `depends_on`, `context`, `allowed_paths`, `forbidden_paths`, body text, owner
decisions) remains included, so the fingerprint still changes whenever anything a human
or reviewer actually reasoned about changes.

### Recovery model (task 02)

Error classes, each with a stable machine-readable code and a recovery policy:

| Class | Example | Auto-recover? | Confirmation | Landing task status (if it blocks) |
|---|---|---|---|---|
| Automatic recovery | Stale generated index (`docs.mjs`/`specs.mjs` `check` failure fixable by `generate`) | Yes — run the fix, then retry the original command | None | n/a (resolved before any status write) |
| Recovery requiring confirmation | Wrong branch with a clean worktree; missing local branch with a known remote | No — propose the fix (checkout/create-from-remote) | One closed-choice confirmation | n/a until confirmed, then resolved |
| Owner decision | Scope expansion beyond `allowed_paths`; ADR conflict; classification escalation | No | Owner-approval-gate stop (unchanged from today) | `needs-decision` |
| Unsafe / manual blocker | Dirty worktree containing unrelated files; stale review after a semantic spec change with no safe auto-fix | No | Full stop, manual resolution | `blocked` |

**Repair → retry → continue rule**: after a Recovery-requiring-confirmation or
Automatic-recovery class error is resolved, the controller re-runs the *original*
operation (never a different one), re-inspects state via `deriveStage`, and continues —
it does not silently repeat a state-changing operation a second time if the first attempt
already partially succeeded (idempotency is judged by `validateTransition`'s existing
`idempotent` flag, not re-derived ad hoc).

`branchExists` gains a remote-aware check (`git rev-parse --verify origin/<name>` when
the local ref is missing) so "missing local branch with known remote" is a real,
detectable case rather than silently creating a diverging branch — this is the concrete
fix for the `handleStart` gap found during discovery.

### Interaction model (tasks 03, 04)

- `deriveStage`'s output becomes the single planning input every conversational command
  consults before acting — no command re-derives "what's next" independently.
- A successful `spec-review` reaching `ready-for-approval` offers approval inline in the
  same turn (a closed-choice menu), rather than only printing a `Next command` block —
  the owner still must answer explicitly; nothing is auto-approved.
- `spec-approve` gains a fourth, explicitly labeled outcome — "approve and start" (D3) —
  alongside its existing three. Choosing it runs `approve`, re-checks `start`'s guards,
  then runs `start`; a `start` failure is reported without touching the now-`approved`
  status.
- `task-review` reaching a fully-terminal change offers to archive inline (already
  designed, per `artifact-policy.md`) and, under an active batch (D2/D4), offers to
  continue to the next batch task inline instead of only printing text.
- Manual, single-step commands (`task-next`, `task-start`, `spec-approve` in its original
  three-outcome form, etc.) remain fully available and unchanged for anyone who wants
  explicit, one-step control.

### Batch execution model (task 08)

- Selection: "all ready tasks," an explicit subset, or "until the next owner-decision
  checkpoint" — chosen once, at batch start.
- Ordering: strict `depends_on` order via the existing `next` logic; unsatisfiable order
  (a cycle or missing dependency) is a pre-flight `validateSpecs` failure, not a runtime
  surprise.
- Concurrency: exactly one task `in-implementation` at a time — no change to "no parallel
  writes to `change.yaml`."
- Self-check: each task in the batch still runs its own lightweight verification
  (`Verification` section commands) before `complete`; a full `task-review` is optional
  per task and required for any task the batch flags as risky (see task 08 for the
  trigger rule) — this is what keeps batch mode from silently skipping review, not from
  requiring N full reviews.
- Gating review: one `changes-recommended`/`owner-decision-required`/`no-findings`-shaped
  batch review at the end, re-using the review-verdict-table pattern
  (`review-policy.md`), checking the complete diff against the batch's start point, every
  batched task's acceptance criteria, and cross-task integration — this is the
  change-integrity gap from finding #10, scoped to "gating" the way `spec-audit` explicitly
  is not.
- Interruption/resume: an interrupted batch is fully resumable from `deriveStage` plus a
  small persisted "active batch" pointer (which tasks were requested, which are done) —
  no new task-level status is introduced for this.
- Temporary inconsistency: a batch may declare that task N intentionally leaves the repo
  inconsistent for task N+1 to resolve, but only inside one batch, only between two named
  tasks, visible in the batch's own state, and `validate`/`check` at the batch boundary
  (not after every task) is what actually gates — see task 08 for the exact declaration
  shape.

### Validation and evidence model (tasks 05, 06)

- Context completeness: derive a suggested-context set from `docs/ai/task-routing.md` +
  `docs/ai/change-impact-map.md` + the task's own touched-path globs, diff it against
  `context.required`/`optional`, warn (never silently block) on a material gap, and accept
  an explicit `context_exception: <reason>` front-matter field for an owner-approved
  omission.
- Consequential/mechanical paths: `allowed_paths` gains an optional, separately-labeled
  `consequential_paths` list — direct, mechanical, generated-or-reference-only
  consequences (broken links, stale indexes) reachable from the task's primary scope; any
  write there is still shown in the diff and still reviewed, it is simply not a scope
  violation by construction.
- Durable follow-ups: a small structured ledger entry (source task, reason, severity,
  blocks-completion?, resolver task if known, resolution state) recorded in a compact,
  append-only `follow-ups.md` per change (not a full issue tracker) — `NON_BLOCKING`
  review findings gain an explicit "record as follow-up" action instead of only living in
  an overwritten review file.
- Acceptance-criteria evidence: `templates/task.md`'s "Acceptance criteria" section gains
  a per-criterion verification tag (`automated: <command>` / `inspection: <what to check>`
  / `owner-decision: <what was decided>`), not a requirement that every criterion be
  automated.

### Token and complexity budget

| Mechanism | Expected token effect | Added complexity | This change? |
|---|---|---|---|
| Fingerprint field-stripping (D1) | Avoids full spec re-reviews triggered by unrelated status churn | Low — one parsing change in `service.mjs` | Yes |
| `deriveStage`-driven inline transitions (D2/tasks 03-04) | Removes repeated "what's next" reasoning and repeated file reads per command boundary | Low-medium — commands call an existing function instead of re-deriving | Yes |
| Batch execution + gating review (D4/task 08) | Largest reduction: N task turns collapse toward 1 batch confirmation + 1 review, for small/low-risk tasks | Medium — new selection/ordering/self-check/gating-review logic, new tests | Yes |
| Context completeness check (task 05) | Avoids incomplete-context rework mid-task | Low-medium — new derivation step, kept warn-only to avoid false blocks | Yes |
| Mechanical task type (D4/task 07) | Removes full review-approve cycle for narrow, low-risk follow-ups | Medium — new conditions to enforce correctly or it becomes a scope-bypass | Yes |
| Recovery classification + retry (task 02) | Avoids re-explaining a known recoverable failure to the owner every time | Low — reuses existing statuses and `validateTransition`'s idempotency flag | Yes |
| Full workflow engine / generic state DSL | N/A — explicitly rejected | High | No — out of scope |
| Parallel task execution | N/A — explicitly rejected | High, unsafe for shared `change.yaml` | No — out of scope |

## Compatibility and migration

- Existing `change.yaml` files (including the in-flight `nevo-documentation-architecture`,
  used as the concrete migration case study) need no structural migration for D1 — the
  fingerprint change is purely computational (which bytes get hashed), not a schema
  change to `change.yaml` itself.
- Any `reviews/*.md` with a `spec_fingerprint` computed under the old (whole-file) scheme
  becomes stale under the new scheme the moment this change ships; task 09 documents this
  as an expected one-time re-review requirement, not a bug, and `finalize`/`approve`'s
  existing "stale fingerprint" error message already surfaces it correctly with no
  further code change needed there.
- `allowed_paths`/`context.required`/acceptance-criteria additions (tasks 05-07) are all
  additive, optional front-matter fields — a task file that doesn't use them behaves
  exactly as it does today.
- `blocked`/`needs-decision` were already valid-but-unreachable statuses; making them
  reachable does not change how any existing terminal-status check treats them (they were
  never in `TERMINAL_STATUSES` and remain excluded).
- Manual, single-step `tools/specs.mjs` commands and `.claude/commands/nevo-ai/*.md`
  entry points remain available throughout — nothing in this change removes a command.

## Areas

- `areas/state-and-fingerprint-semantics.md` — task 01
- `areas/recovery-and-resume.md` — tasks 02, 03
- `areas/conversational-continuity.md` — task 04
- `areas/context-and-validation-hardening.md` — tasks 05, 06, 07
- `areas/batch-execution-and-gating-review.md` — task 08
- `areas/finalization-and-migration.md` — tasks 09, 10

## Change-wide acceptance criteria

1. `computeSpecFingerprint` excludes `status` (change- and task-level) from its hashed
   input; a test proves a task status change does not alter another task's fingerprint
   inputs.
2. `depsSatisfied` no longer treats `abandoned` as dependency-satisfying; a test proves a
   task depending on an `abandoned` task is not `next`-ready.
3. `deriveStage` (or a documented extension of it) is the single source `spec-review`,
   `spec-approve`, `task-review`, and the batch controller consult for "what's next" — no
   command file re-derives its own competing next-step logic.
4. A defined recovery class (automatic / confirm-required / owner-decision / unsafe) exists
   for at least the eight example scenarios enumerated in the original findings, each with
   a stable machine-readable code.
5. `spec-approve` offers a fourth "approve and start" outcome that performs two separate
   CLI transitions with a guard re-check between them and no rollback/re-approval on
   `start` failure.
6. Batch execution runs an owner-selected, dependency-ordered sequence of approved tasks
   with exactly one task `in-implementation` at a time, and produces exactly one gating
   batch review at the end whose verdict follows the same derived-table pattern as
   existing review verdicts.
7. Context completeness checking warns (never silently blocks) on a declared/inferred
   context gap and accepts an explicit owner-approved exception.
8. `allowed_paths` supports an optional, separately-labeled `consequential_paths` list
   that a task-review-time check (or equivalent) does not flag as a scope violation.
9. `spec-finalize` performs at least one concrete post-merge check against the merge
   result (not only pre-merge gate facts).
10. `node --test tools/tests/` covers: fingerprint field-exclusion, `depsSatisfied` with
    `abandoned`, at least one recovery class end-to-end, the approve+start combined path
    (success and `start`-failure), batch execution ordering and the single-active-task
    constraint, and the mechanical task type's auto-approval conditions (including at
    least one condition that correctly denies auto-approval).

## Verification strategy

`node --test tools/tests/` (new and existing suites), `node tools/specs.mjs validate` /
`check`, `node tools/docs.mjs validate` / `check` (docs touched by task 10), and a
dogfooding pass: this change's own tasks are taken through `task-start` →
implement → `task-review` at least once each using the very mechanisms it adds, once
implementation begins (not part of this specification step).

## ADR impact

This change makes durable decisions (fingerprint scope, the approve+start exception, the
batch/gating-review model) that future changes will need to know about. Recommend a new
ADR (`ADR-0006` — exact number assigned at write time) capturing: why fingerprints exclude
status, why `approve`+`start` gained a combined-confirmation exception to the
previously-absolute separation rule, and why batch execution is sequential-only. Writing
that ADR is folded into task 10 rather than a separate task. No existing ADR is superseded.

## Out of scope

- A general-purpose workflow engine or state-machine DSL.
- Parallel task execution or any concurrent write path to `change.yaml`.
- Using the mechanical task type to bypass an architectural, API, or behavior decision —
  its auto-approval conditions (task 07) are written to make this structurally
  impossible, not just discouraged.
- New external infrastructure (databases, queues, hosted workflow services).
- Removing or renaming any existing `/nevo-ai:*` command or `tools/specs.mjs` subcommand.
- Making batch execution or auto-continue the default behavior for a single ad hoc task —
  both remain something the owner explicitly opts into per invocation.
