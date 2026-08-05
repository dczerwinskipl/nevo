---
id: ai.specification-workflow
type: ai
title: NEvo specification workflow
status: current
read_when:
  - starting a new change
  - deciding how much specification a change needs
  - unsure whether a decision needs owner approval
  - presenting an architectural, public-API, or package-boundary decision to the owner
summary: >
  Vendor-neutral description of NEvo's human-led, spec-anchored development process:
  how changes are classified, discovered, specified, decomposed into tasks, and
  implemented, and how tools/docs.mjs and tools/specs.mjs enforce it.
related:
  - ai.how-to-navigate
  - ai.task-execution-policy
  - adr.0002-lightweight-markdown-workflow
  - adr.0003-technical-decision-triage-and-option-analysis
  - adr.0004-review-artifacts-and-handoff
  - adr.0005-deterministic-approval-and-hardened-guard
  - adr.0006-process-continuity-and-hardening
---

# NEvo specification workflow

This document is the single vendor-neutral source of truth for how AI agents plan and
execute changes in this repository. It applies equally to Claude Code, Cursor, GitHub
Copilot, and any other tool. Tool-specific adapters (`CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, and Claude's `/nevo-ai:*` commands) point here instead
of duplicating it.

The process itself — and the decision to build a lightweight custom workflow instead of
adopting an external framework — is recorded in
[ADR-0002](../decisions/ADR-0002-lightweight-markdown-workflow.md).

## Principles

1. **Human-led.** The repository owner makes architectural and scope decisions. Agents
   propose options and a recommendation; they do not decide on the owner's behalf.
2. **Spec-anchored.** Non-trivial work is described in a specification before it is
   implemented. Agents load only the context a task declares as required, not the whole
   repository.
3. **Separation of specification and implementation.** Writing or refining a spec never
   implies starting implementation, and vice versa. Each is a distinct, explicit step.
4. **Deterministic where possible.** Status transitions, branch creation, and index
   generation go through `tools/specs.mjs` and `tools/docs.mjs`, not natural-language
   guesses.

## Change classification

Every change is classified before any artifact is created. See `AGENTS.md` for the
authoritative table; in summary:

| Class | Spec required |
|---|---|
| **S — Small** | None |
| **T — Standard** | `specs/active/<slug>/spec.md` (or an equivalent single-file spec) |
| **A — Architectural** | Full change directory: `change.yaml`, `overview.md`, optional `areas/`, `tasks/` |
| **E — Exploratory** | `specs/active/<slug>/discovery.md`, owner decides the next class |

When in doubt between two classes, evaluate the signal-based classification below rather
than guessing — ambiguity routes to **E** (discovery first), never to a blanket
preference for the smaller class.

### Signal-based classification

Judgment calls on S/T/A/E drift over time without a shared basis. Before classifying,
evaluate the change against these technical signals — each rated GREEN (clearly yes,
with evidence), YELLOW (uncertain — state what's missing), or RED (clearly no /
contested):

| Signal | Question |
|---|---|
| Behavioral clarity | Is the expected behavior fully determined by existing tests, docs, or an established pattern already used elsewhere in the codebase? |
| Public surface impact | Does the change avoid altering any public API, contract, or a package's exported surface? |
| Package boundary impact | Is the change contained within one package/project, introducing no new inter-package dependency (see `docs/development/package-boundaries.md`)? |
| Blast radius | Does the change affect only the named file(s)/type(s), without touching shared infrastructure (messaging pipeline, persistence base types, middleware pipeline)? |
| Reversibility | Can the change be reverted without a migration, a breaking-change release, or renegotiating a contract? |

Never infer GREEN from silence — evaluate only what the request and repository evidence
actually support.

Classification rule:
- All GREEN → **S**
- One or two YELLOW, blast radius GREEN → **T**
- Public surface impact RED, package boundary impact RED, or blast radius RED → **A**
- Reversibility RED (cannot be undone without a migration or breaking release) → at
  least **A**, regardless of the other signals
- Classification cannot be safely determined from available evidence → **E** (discovery
  first; the owner decides the next class from the discovery report)

### Escalation is explicit and one-way

A change may be reclassified upward mid-work, never silently absorbed into the original
scope:

- **S → T**: implementation reveals a public-surface change, a new inter-package
  dependency, or a behavior change beyond the original one-line description.
- **T → A**: implementation reveals the change cannot stay inside one package, needs a
  new external dependency, changes transaction/persistence semantics, or requires a
  breaking change.
- **A** is the final level for implementation work. If an Architectural change turns out
  to be genuinely unscoped, drop back to **E** (discovery) explicitly rather than
  guessing further.

When escalating: stop, name the specific signal that flipped, state the new
classification, and run the owner-approval gate below before continuing — do not keep
implementing under the old classification's assumptions.

## Discovery before specification

Before proposing a specification, an agent must ground itself in the current repository
state:

- current behavior of the affected area (code, tests, examples),
- existing documentation (`docs/development/`, `docs/decisions/`),
- whether an active or archived change already covers the same ground,
- constraints implied by accepted ADRs.

Broad, read-only exploration that would otherwise crowd the main context should be
delegated to a read-only research subagent (in Claude Code: `nevo-ai-spec-researcher`).
The researcher returns facts and evidence, not architecture decisions.

Discovery output separates:
- **facts** — directly observed in code or docs,
- **inferences** — reasonable conclusions drawn from facts,
- **inconsistencies** — places where sources disagree,
- **open questions** — things that must be asked, not guessed.

## Owner approval gates

Some decisions may never be inferred by an agent. The authoritative list lives in
`AGENTS.md` under "Decision policy" (public API shape, package dependency direction, new
external dependencies, transaction semantics, persistence ownership, message processing
behavior changes, breaking changes, compatibility decisions, new packages/projects,
CI/CD changes). When a change touches one of these, the agent presents options and a
recommendation, then stops and waits — it does not proceed on an assumed answer.

## Solution option analysis

**The agent's role is to support the decision, not make it.** Whenever a change is
classified **T** or larger *and* touches one of the owner-approval gates above, the
agent does not go straight from "here's a change" to "here's the plan" — it stops
between the two and presents options.

### Do not default to the simplest option

The instinct to reach for the smallest possible diff is useful for effort estimation,
but wrong as a decision rule here. For any change gated above, present at least two
meaningfully different options — typically framed as:

1. **Minimal change** — the smallest change that satisfies the acceptance criteria using
   established patterns already in the codebase.
2. **Balanced improvement** — addresses the underlying structural issue (the reason a
   minimal change would be a shortcut) without a full redesign.
3. **Target shape** — the cleanest long-term structure, if its cost is justified.

Rename these to fit the actual trade-off being made. Do not force a third option when
only two real trade-offs exist; propose a fourth when a genuinely distinct trade-off
exists beyond these three. Each option must represent a materially different trade-off,
not a cosmetic variation of another.

### Check for an existing solution before proposing a custom one

Before designing a custom implementation for a generic concern (serialization, caching,
retry/backoff, background scheduling, schema/OpenAPI generation, and similar
infrastructure-shaped problems), check whether the .NET BCL or an already-referenced
package already solves it. Include "use existing package/API `X`" as a candidate
alongside "custom implementation" — for a framework whose own purpose is to provide
building blocks (see `README.md`), reinventing infrastructure that already exists
elsewhere is a cost, not a virtue. Adding a *new* external dependency still requires
owner approval regardless of which option is eventually chosen.

### Evaluate options on relevant dimensions only

Include dimensions that would actually change the recommendation; state "not relevant"
for the rest rather than filling every cell:

implementation cost · long-term maintenance cost · coupling and cohesion (see the
coupling checks below) · reversibility · public-API / breaking-change risk · test and
regression scope · performance/allocation impact · consistency with established NEvo
patterns (e.g. `Either<Exception, T>`, package boundaries) · migration cost if replacing
existing behavior.

Size each option with a t-shirt size — a relative-complexity signal, not a time
estimate:

| Size | Meaning |
|---|---|
| XS | Trivial, local, no structural impact |
| S | Small, one package, known pattern |
| M | Moderate — one main package plus some cross-cutting impact |
| L | Significant — affects multiple packages or a public contract |
| XL | Architectural — new package, dependency-direction change, breaking change, migration |
| XXL | Too large for one slice — split before proceeding |

### Coupling and package-boundary checks

Run these whenever an option introduces or changes a cross-package relationship (see
`docs/development/package-boundaries.md` for the current boundaries):

- **Structural coupling** — does the option add a new dependency between packages? Is
  its direction consistent with the documented boundaries? A new dependency against the
  documented direction, or a new bidirectional dependency, is an architectural concern
  requiring approval regardless of which option is otherwise cheapest.
- **API-surface coupling** — does any option require one package to depend on another
  package's *internal* (non-exported) types? That is a boundary violation regardless of
  short-term convenience.
- **Extraction test** — if the affected package were versioned and shipped
  independently, would this option create a circular reference back to it? Flag this
  explicitly as a high-risk consequence if so.

### The consequences rule

When two or more options have materially equal cost, **do not silently pick one.** State
explicitly, for each option, what it unlocks (future work it makes easier or possible)
and what it forecloses (what becomes harder or impossible later if this option is
chosen). This is a required part of the recommendation, not an optional aside — the
owner may weigh a foreclosed future path very differently than the agent would.

### Recommending

Recommend the option that best satisfies, in order: (1) the acceptance criteria, (2) the
owner's stated priorities, if any were given, (3) known constraints (ADRs, package
boundaries, compatibility requirements), (4) lowest long-term maintenance cost among the
options that satisfy 1–3. Implementation cost *now* is a tie-breaker of last resort, not
the primary driver — do not let it override a stated priority or a foreclosed-future
consequence the owner has not weighed in on. Always state explicitly why each
non-recommended option was rejected.

### Presenting for confirmation

Present, before generating any implementation plan: the recommended option and why, what
would be implemented if approved, what stays out of scope, decisions the owner must make
now versus ones that can be deferred, and any unresolved open questions that still
matter. Then ask for a decision using a small, closed set of choices rather than an
open-ended question, for example:

```
1. Yes, use this option.
2. No, revise the options.
3. Re-analyze with different priorities.
4. I want to provide my own direction.
```

Do not generate implementation tasks in the same step unless the owner has already
approved a direction.

## Artifact decomposition

A specification should be no larger than it needs to be:

- A **Standard** change is a single spec file.
- An **Architectural** change splits into `areas/` when it has more than one
  independently implementable concern, so that each area (and each task inside it) can
  carry its own, smaller context packet.
- Do not create empty template sections or files "for completeness." Every artifact
  earns its place by reducing ambiguity or context size for the agent that implements it.

## Task context packets

Every implementable task carries `context.required`, `context.optional`,
`allowed_paths`, and `forbidden_paths` in its front matter. `tools/specs.mjs context <change> <task>` resolves this into a JSON packet. Agents load `required` context before
touching code, load `optional` only if the task text references it, and treat
`allowed_paths`/`forbidden_paths` as a hard scope boundary — not a suggestion. This is
what keeps large specifications from forcing every task to read the entire change.

## State model: statuses, suspension, and semantic fingerprints

### Status vocabulary

A task's `status` (in `change.yaml`) is one of `draft` / `approved` / `in-implementation`
/ `implemented` / `verified` / `abandoned` / `archived`; a change's own `status` is one of
`draft` / `approved` / `in-implementation` / `implemented` / `verified` / `abandoned` /
`archived`. `blocked` and `needs-decision` are **not valid values at either level** —
`tools/specs.mjs validate` rejects either one with a fixed message: `` Status `blocked` is
no longer supported. Use `execution.suspension`. `` (and the `needs-decision`
equivalent). They were removed rather than left valid-but-unreachable, because a status
value validation accepts but no transition can ever leave is itself a defect. A recoverable
stop is represented by `execution.suspension` (below) instead, which never overwrites the
task's real `status`.

`depsSatisfied` treats `implemented` / `verified` / `archived` as dependency-satisfying;
`abandoned` is terminal (it doesn't block `finalize`) but does **not** satisfy a
dependent's `depends_on` — a dependent cannot build on work that was dropped.

### `execution.suspension` — why the last action stopped, orthogonal to status

An optional block on a task's `change.yaml` entry, present only while the task's last
attempted action is stopped on something recoverable:

```yaml
execution:
  suspension:
    kind: automatic | confirm-required | owner-decision | unsafe-manual
    code: <a recovery scenario identifier>
    previous_action: <the operation to retry>
    created_at: <ISO timestamp>
```

The task's own `status` is never overwritten by a suspension — a task that was `approved`
and failed to `start` stays `approved` with a suspension attached. `tools/specs.mjs validate` checks `kind` is one of the four listed values and `code` is a non-empty string;
it does not check `code` against a specific enum, but the canonical scenario set
(`REC-01`..`REC-09`, area recovery-and-resume) is fixed and documented in
`tools/lib/cli-errors.mjs`. `approve`/`start` write and clear `execution.suspension`
directly — a `RecoveryError` (its `class`/`code`/`recovery.suggestedFix` fields
machine-readable, not just a human sentence) is what a caller branches on. `deriveStage`
(`tools/specs/lifecycle.mjs`) is suspension-aware: a task with an active suspension
reports its `kind`/`code` and, for `confirm-required`, what's still needed, instead of
the stage's usual recommended action.

### `semantic_references` — a task's declared dependency/decision/constraint scope

An optional block in a task file's own front matter (absent, or all three lists empty, is
valid — it means the task's fingerprint depends on nothing beyond its own content):

```yaml
semantic_references:
  decisions: [D7, D13]              # owner-decisions.md entries this task's content depends on
  constraints: [C2]                 # named constraints from overview.md's numbered "Constraints" section
  dependency_contracts: [task-a]    # subset of depends_on whose scope this task actually relies on
```

`validate` checks reference *integrity*, not completeness: every `dependency_contracts`
entry must already be in the task's own `depends_on`; every `decisions`/`constraints`
entry must resolve (an owner decision explicitly marked superseded resolves to an error
naming the decision to reference instead). Whether the list is *complete* — whether it
covers everything the task's content actually depends on — is a separate, model-review
concern, not something schema validation alone can prove.

### `self_check` — a task's own last verification outcome

An optional block on a task's `change.yaml` entry, structurally parallel to
`execution.suspension`:

```yaml
self_check:
  status: failed | passed        # absent block == "not run"
  fingerprint: <task-level semantic fingerprint at the time this self-check ran>
  revision: <git SHA at the time this self-check ran>
  failed_criteria: [AC-3, AC-5]   # only when status: failed
  commands:
    - command: "node --test tools/tests/foo.test.mjs"
      exit_code: 0
```

`validate` checks the shape (`status` is `failed`/`passed`; `failed_criteria` only appears
with `status: failed`; each `commands` entry has a `command` string and an integer
`exit_code`). `node tools/specs.mjs self-check <change> <task>` is the single write
path (area batch-execution-and-gating-review, D28) — it runs every command the task's
own "## Verification" section names and records the outcome; no other code writes this
field. `deriveStage` reads it back (read-only) to report one of four self-check states —
see "Self-check state" in the derived-vs-persisted inventory below.

### Three-tier semantic fingerprint

`tools/specs/service.mjs` exposes three canonical-projection fingerprint functions. The
`approve` gate and `node tools/specs.mjs fingerprint <change>` both read
`computeChangeFingerprint` — the change-level tier, not the retired single whole-spec
`computeSpecFingerprint` (still exported, no longer read by any command — see "Review
freshness" below):

| Function | Covers | Excludes |
|---|---|---|
| `computeChangeFingerprint(change)` | `overview.md`'s full content (change scope, shared constraints, change-level acceptance criteria) plus the task graph's shape — every task's id and `depends_on` edges, nothing else | Per-task `status`, `execution.suspension`, `self_check` |
| `computeTaskFingerprint(change, taskId)` | That task's own file content (goal, constraints, acceptance criteria), `context`/`allowed_paths`/`consequential_paths`/`forbidden_paths`, its own `depends_on` edges, and its `semantic_references` — resolved, not echoed: each referenced decision's/constraint's current text, and each `dependency_contracts` entry's own task-level fingerprint (recursively) | `status`, `execution.suspension`, `self_check` |
| `computeImplementationFingerprint(change, taskId, { revision, evidence })` | The task-level fingerprint plus a revision identifier and evidence references | Same as above |

Each function extracts specific semantic fields and hashes that projection — never raw
file bytes — so operational fields are simply never read, not excluded after the fact.
Adding or removing any task always invalidates `computeChangeFingerprint` (the task graph's
id set is one of its declared inputs); an unrelated task's own task-level fingerprint is
unaffected unless its `semantic_references.dependency_contracts` names the added/removed
task.

## Terminology — one term per concept

The same underlying fact must never be called two different things across this document,
the command files, and the shared skill. Use exactly these terms:

| Term | Meaning | Never call it |
|---|---|---|
| **Lifecycle status** | The stable `status` field (`draft`/`approved`/.../terminal) on a task or change. | A "state," a "blocker," or conflated with a suspension. |
| **Execution suspension** | The orthogonal `execution.suspension` block (D8) — why the *last attempted action* stopped, independent of lifecycle status. | A status, a lifecycle state, or "blocker" alone. |
| **Owner decision** | A recorded entry in a change's `owner-decisions.md` (`D<n>`). | A "note" or "comment." |
| **Review status** | A review file's `verdict` (spec / task / batch / audit review). | A lifecycle status. |
| **Batch state** | The persisted batch-intent file's contents (D10, `batch.json`) plus the progress *derived* from `change.yaml` at read time. | "Batch status" — that phrase means a task's own `status` field. |
| **Retry target** | `execution.suspension.previous_action` — the operation a resumed session retries. | A "next step" (that's `deriveStage`'s `nextCommand`, a different concept). |
| **Recommended action** | `deriveStage`'s `nextCommand` output — the single next command a caller should run or offer. | A "suggestion" (it's derived, not guessed). |
| **Semantic reference** (D18) | An entry in a task's `semantic_references` block (`decisions`/`constraints`/`dependency_contracts`) — declares what the task's *content* actually depends on. | A "dependency" alone — `depends_on` can express pure ordering with no semantic reference. |
| **Evidence freshness** (D19) | Whether a batched task's recorded evidence (self-check or inspection) is still current given later batch changes. | "Evidence validity," or conflated with the task's own acceptance-criteria verdict. |
| **Batch selection mode** (D20) | One of the four named modes (`currently-ready`/`all-approved-reachable`/`named-subset`/`until-checkpoint`). | "Batch scope" — that's the broader authorized-scope concept, which also covers a single named task. |
| **Diagnostic anchor** (D23) | The preserved merged branch after a post-merge verification failure. | A "recovery anchor" — the branch doesn't itself repair `main`. |
| **Hard stop condition** (D24) | A batch failure (failed/unresolved self-check, failed acceptance criterion, failed automated verification, unrefreshable stale evidence, missing required evidence, or a verification-blocking implementation error) that halts a batch immediately — a full `task-review` is never a substitute. | Conflated with a full-review risk signal (D11), which is only evaluated *after* a task's self-check has already passed. |
| **Reference integrity vs. reference completeness** (D26) | *Integrity*: a declared `semantic_references` entry exists/is active/isn't duplicated — checked deterministically by `validateSpecs`. *Completeness*: the declared list covers everything the task's content actually depends on — checked by a model-review step inside `/nevo-ai:spec-review`. | Conflated — a task can pass integrity checks while still being incomplete. |
| **Missing vs. unnecessary reference** (D29) | *Missing*: a load-bearing reference the task needs but doesn't declare — blocks approval (`AUTO_FIX` if unambiguous which one, `OWNER_DECISION` if ambiguous). *Unnecessary*: a declared reference that isn't actually load-bearing — may stay `NON_BLOCKING`. | A missing reference described as merely "worth noting" — it blocks by default until resolved. |

## Derived versus persisted state

Knowing which facts are *stored* and which are *computed fresh every time they're needed*
is what makes "resume after an interruption" safe — there is nothing to reconcile for a
derived fact, since it's never written twice.

| Fact | Persisted or derived | Where |
|---|---|---|
| Task lifecycle status | Persisted | `change.yaml` task entry's `status` |
| Active execution suspension | Persisted | `change.yaml` task entry's `execution.suspension` |
| Active batch intent | Persisted (intent only — no progress fields) | `specs/active/<change>/batch.json` |
| Self-check outcome | Persisted | `change.yaml` task entry's `self_check` |
| Follow-up ledger | Persisted (mutable current-state, not append-only) | `specs/active/<change>/follow-ups.yaml` |
| Current / completed / next / failed batch task | Derived, every call | `deriveBatchProgress(change, intent)` reads task `status`/`execution.suspension`/`self_check` |
| Review freshness | Derived | Recomputing the relevant fingerprint tier and comparing to the review's stored value |
| Self-check freshness (not-run / failed / passed-and-fresh / passed-but-stale) | Derived | `deriveStage` compares `self_check.fingerprint`/`revision` against the task's *current* values |
| Available/recommended action | Derived | `deriveStage`'s `nextCommand` |
| Worktree status (clean/dirty) | Derived | `git status --porcelain` at read time |
| Current branch | Derived | `git branch --show-current` at read time |

## Using `tools/specs.mjs`

```
node tools/specs.mjs generate                  # rebuild specs/*.generated.*
node tools/specs.mjs validate                  # validate all change manifests
node tools/specs.mjs check                     # validate + verify indexes are current
node tools/specs.mjs list                      # list active changes and task statuses
node tools/specs.mjs next                      # next approved, dependency-ready task → JSON
node tools/specs.mjs context <change> <task>   # context packet for one task → JSON
node tools/specs.mjs fingerprint <change>      # change-level fingerprint (for review freshness)
node tools/specs.mjs approve <change> <task>   # mark task approved — requires draft status and a current, ready, fully-resolved review (or the type: mechanical exemption)
node tools/specs.mjs start <change> <task>     # create/switch branch, set task in-implementation
node tools/specs.mjs complete <change> <task>  # mark task implemented
node tools/specs.mjs verify <change> <task>    # mark task verified (owner-reviewed)
node tools/specs.mjs archive <change>          # move a fully terminal change to specs/archive/
node tools/specs.mjs status <change>           # read-only: where this change sits in the spec → task → PR → merge chain
node tools/specs.mjs finalize <change> [--check]   # gate, then merge + archive (see "Finalizing" below)
node tools/specs.mjs self-check <change> <task>    # run the task's own "## Verification" commands, write self_check
node tools/specs.mjs follow-up-add <change> <id> --source-task <t> --kind <k> --severity <blocking|non-blocking> --reason <r>
node tools/specs.mjs follow-up-resolve <change> <id> --resolution <r> [--dismiss] [--decision-ref <D-id>]
node tools/specs.mjs batch-start <change> <mode> [--tasks <id,id,...>]   # select and start a batch (see "Batch execution")
node tools/specs.mjs batch-status <change>     # read-only: derived batch progress, hard-stop/risk-signal state
node tools/specs.mjs batch-review <change>     # evidence-freshness check, then the gating batch review
node tools/specs.mjs finalize-repair-branch <change> --failing-sha <sha>   # guarded repair-branch creation (see "Finalizing")
```

`start` refuses to run on a dirty working tree, classifying it as `REC-05`
(task-related files — confirm-required) or `REC-06` (an unrelated file — owner-decision,
never auto-touched). `next` only ever returns a task whose status is `approved` and
whose dependencies are all in a terminal status (`implemented`, `verified`, `archived`,
`abandoned`) — task selection is never a manual scan of spec files.

### Recovery and the resume-and-continue controller

Every state-changing action's precondition failure is classified against a canonical set
of nine recovery scenarios (`REC-01`..`REC-09`, `tools/lib/cli-errors.mjs`), each with a
fixed `class` — `automatic` (fixes itself same-turn, no suspension needed),
`confirm-required` (one closed-choice confirmation clears it), `owner-decision` (the
owner decides, not the controller), or `unsafe-manual` (no automated or confirmed path
exists — the controller stops and waits). Recovery always inspects real state and
executes only the missing effects — it never repeats a completed, externally-visible
effect (e.g. never re-creates a branch that already exists). This is a five-value
postcondition-result vocabulary (`completed` / `safe_to_retry` / `partially_completed` /
`not_retryable` / `unsafe_manual`), not a boolean — `not_retryable` means the original
action's own preconditions changed since the suspension was recorded (a fresh suspension
replaces the stale one); `unsafe_manual` never resolves itself and is never auto-retried.

An authorized combined transition (e.g. `spec-approve`'s "approve and start") that hits a
`confirm-required` stop does not end there: once the owner confirms, the same
postcondition-inspection function re-runs against fresh state — that re-invocation *is*
the resumable recovery handle — and only the still-missing effects execute, completing
the authorized sequence. A confirmation is asked **at most once per repair**; if the
re-inspected postconditions still don't hold afterward, that's a fresh
`not_retryable`/`unsafe_manual` result, never a repeated prompt.

An authorized scope — a single named task, or one of the four batch-selection modes
below — bounds how far the controller may continue automatically. Inside it, the
controller continues through `completed`/`safe_to_retry`-resolved recoveries and, once
confirmed, through a `confirm-required` recovery, without ending the loop. It stops
immediately for: implicit scope expansion (`REC-08`), an `unsafe_manual` result,
unrelated dirty files (`REC-06`), a `not_retryable` result, a failed acceptance
criterion, unresolved high-risk evidence, stale unresolved batch evidence, or the end of
the authorized scope — never past it, regardless of how safe the next step looks.

### Batch execution

`node tools/specs.mjs batch-start <change> <mode>` runs a sequence of already-`approved`
tasks under one authorization, one of four named selection modes — **no default**:

| Mode | Selects |
|---|---|
| `currently-ready` | Only tasks `next`-ready at planning time. |
| `all-approved-reachable` | Every approved task that becomes ready once earlier-selected tasks complete — a deterministic topological order over the approved subgraph. Expresses "run every approved task reachable through the graph" for a linear dependency chain, which `currently-ready` alone could only ever select the first task of. |
| `named-subset` | An explicit task-id list, validated for closure over required dependencies — a missing prerequisite is reported, never silently included or excluded. |
| `until-checkpoint` | The same reachable sequence as `all-approved-reachable`, executed until a named checkpoint. |

Exactly one task is ever `in-implementation` during a batch; the batch controller calls
the existing `start`/`complete` transitions unchanged. The persisted intent file
(`specs/active/<change>/batch.json`) holds only intent — `change`, `requestedTasks`,
`orderedTasks`, `startRevision`, `reviewMode`, `checkpointPolicy`,
`temporaryInconsistencies` — **never** a `completed`/`current`/`next`/`failed` field;
`node tools/specs.mjs batch-status <change>` derives those, every time, from each
`orderedTasks` entry's current `status`/`execution.suspension`/`self_check` in
`change.yaml` — there is nothing to reconcile after an interrupted write.

**Hard stop conditions are evaluated before any risk signal, and a full `task-review` is
never a substitute for one.** The batch stops immediately when the current task has: a
failed self-check, an unresolved self-check, a failed acceptance criterion, failed
automated verification, stale unrefreshable evidence, missing required evidence, or an
implementation error preventing verification. Only once a hard stop is cleared (the
implementation corrected, the self-check rerun and passing) do **risk signals** decide
whether a full `task-review` is additionally required before the task can be
batch-completed: a declared `review: required`, public-API/compatibility impact,
security/data-safety impact, migration/destructive-persistence behavior, an
`owner-decision:`-tagged acceptance criterion, scope expansion, missing automated
verification, unexpected files, implementation divergence, or an owner-flagged
high-risk task. Touching `src/**`/`tests/**`/`consequential_paths` alone is **not** a
risk signal — a small, low-risk task completes via self-check plus the final gating
batch review only.

**Evidence freshness** is checked immediately before the gating batch review runs, as
its own distinct step, never folded silently into the review: a later-batched task's
file/path overlap with an earlier task's recorded evidence, or a mismatch between
`self_check.fingerprint`/`revision` and the task's *current* semantic fingerprint/git
revision (D28's "passed but stale"), invalidates that evidence and triggers a self-check
rerun before the review may proceed. Evidence that cannot be refreshed is itself a hard
stop, never a caveat the review proceeds past.

`node tools/specs.mjs batch-review <change>` is the one gating review that closes a
batch — it never re-evaluates any individual batched task's own acceptance criteria
(those were already gated by that task's own self-check, and, for a risky task, its own
`task-review`). It checks only the whole-batch diff since `startRevision`, cross-task
integration, and open `blocking`-severity `follow-ups.yaml` entries, computing its
`no-findings`/`changes-recommended`/`owner-decision-required` verdict from an explicit
table (same shape as a change-wide audit's) and writing
`specs/active/<change>/reviews/batch-<id>.md`.

A declared temporary-inconsistency pair (named up front in the batch intent) is the one
exception: `validate`/`check` failing *between* those two tasks' implementations doesn't
block batch progress — every other boundary in the batch still enforces it.

### The follow-up ledger

`specs/active/<change>/follow-ups.yaml` is a small, mutable, schema-validated,
current-state list — **not** append-only: `node tools/specs.mjs follow-up-resolve`
mutates an existing entry's `status` in place, it never appends a duplicate. Fields per
entry: `id`, `source_task` (must resolve to a real task id), `kind`, `severity`
(`blocking`/`non-blocking`), `reason`, `resolver_task` (nullable — a real task id, in
this change or an explicitly named one), `status` (`open`/`resolved`/`dismissed`),
`resolution` (populated on resolve/dismiss), `decision_ref` (nullable — a structured
`D<n>` reference, distinct from `resolution`'s free-form text). `task-review`/
`spec-audit` offer "record as follow-up" for a `NON_BLOCKING` finding — an explicit,
separately-confirmed action, never automatic. Dismissing a `blocking` entry requires
`decision_ref` to cite a recorded, currently-active (non-superseded) owner decision — a
decision mentioned only inside `resolution`'s prose does not count; a `non-blocking`
entry needs no such reference. An open, `blocking`-severity entry blocks `spec-finalize`
exactly like a non-terminal task.

### Mechanical tasks — review-exempt deterministic approval

`type: mechanical` lets `approve` skip only the review-file/verdict/fingerprint
requirement — it is **not** auto-approval: `approve` still performs the same explicit,
auditable `draft`→`approved` write, either way. The exemption is granted only when all
six conditions hold, conjunctively (never a score/majority check), re-verified by both
`validate` (hard error naming the failed condition) and `approve` itself (defense in
depth): derived from an already-approved-or-later task in the same change
(`mechanical.derived_from`); `mechanical.deterministic: true`;
`mechanical.no_public_behavior_change: true`; `mechanical.no_new_design_decision: true`;
`allowed_paths`/`consequential_paths` already declared on the `derived_from` task; every
acceptance criterion carries an `automated:` tag (no `inspection:`/`owner-decision:`
tag allowed). Any condition failing falls back to the normal review-then-approve cycle —
it never silently blocks with no path forward, and never silently approves with a
missing condition.

## Using `tools/docs.mjs`

```
node tools/docs.mjs generate                          # rebuild docs/index.generated.*
node tools/docs.mjs validate                           # validate front matter across docs/
node tools/docs.mjs check                               # validate + verify index is current
node tools/docs.mjs find --scope <scope> [--type <type>] [--format json]
```

`docs.mjs` only scans `docs/`. Every document type (`architecture`, `development`,
`adr`, `ai`, `change`) has required front-matter fields enforced by `validate` — see
`tools/docs.mjs` for the exact list per type. `.claude/**` files are intentionally
outside this index: they are Claude-specific adapters, not shared documentation.

## Specification and implementation are separate steps

Producing or refining a specification never authorizes implementation. A specification
is "ready for implementation" only once:

- every task the owner intends to start next has `status: approved`,
- `depends_on` references are satisfied or clearly sequenced,
- `allowed_paths`/`forbidden_paths` are present and unambiguous,
- acceptance criteria are testable, not aspirational,
- `node tools/specs.mjs validate` (and `docs.mjs validate`, if docs changed) passes.

Implementation then proceeds task by task via `tools/specs.mjs start`, never by an agent
inferring that "the spec looks done."

## Review artifacts and handoff

A review — of a specification or of a task's implementation diff — is not finished when
the analysis is finished. It is finished when it has produced something the owner or the
next step can act on without re-reading and re-interpreting a long report.

### Findings are actor-classified

Every finding gets exactly one category, so it's clear who acts on it, not just what was
found:

| Category | Meaning | Who acts |
|---|---|---|
| `AUTO_FIX` | Mechanical, unambiguous correction — no judgment call, no scope/behavior change | Whoever applies fixes, directly — no owner decision needed |
| `OWNER_DECISION` | Falls under an owner-approval gate, or changes scope/behavior/architecture | Owner must decide |
| `NEEDS_CLARIFICATION` | Reviewer needs more information to finish the finding | Owner must answer before it becomes a fix |
| `NON_BLOCKING` | Real, but doesn't block readiness or approval | Optional — owner's call, now or later |
| `INFORMATIONAL` | Confirms something is already correct | No action — context only |

`AUTO_FIX` is still *reported*, never silently applied by the review itself (see below)
— it tells whoever runs the follow-up exactly what's safe to do, it doesn't do it for
them without a trace.

### A review writes a persistent artifact

A review's output is a file, not just conversation text: a specification review writes
`specs/active/<change-id>/reviews/spec.md`; a task implementation review writes
`specs/active/<change-id>/reviews/<task-id>.md`. Each file is overwritten on every run —
it represents the review's *current* state, not a history. Git already tracks that
file's history; there is no separate in-repo versioning scheme for reviews (see
ADR-0004 for why that was deliberately not built).

Writing this one file is the only exception to "review is read-only" — a review never
edits the change, task, or spec artifacts it is evaluating.

### A review's verdict is derived from a table, never composed as a sentence

The failure mode this guards against is real, not hypothetical: a review can correctly
find "unresolved owner decision on task 12" and *separately* conclude "spec ready for
owner approval" — two locally-plausible sentences that were never checked against each
other. The fix is to make the verdict, and two booleans that travel with it, the output
of an explicit table rather than independent prose:

| # | Condition | Verdict | `ready_for_approval` | `implementation_allowed` |
|---|---|---|---|---|
| 1 | Validation fails, or sources of truth contradict unresolvably | `blocked` | false | false |
| 2 | An unresolved `OWNER_DECISION` or `NEEDS_CLARIFICATION` finding exists | `owner-decision-required` | false | false |
| 3 | An unresolved `AUTO_FIX` finding exists (rows 1–2 don't apply) | `changes-required` | false | false |
| 4 | No unresolved findings from rows 1–3 remain, but the relevant task(s) aren't `approved` | `ready-for-approval` | true | false |
| 5 | No unresolved blocking findings remain, and the relevant task(s) **are** `status: approved` in `change.yaml` (checked, not assumed) | `approved-for-implementation` | true | true |

Evaluate top to bottom; the first matching row wins. `NON_BLOCKING`/`INFORMATIONAL`
findings never appear in the table — they cannot affect the verdict, by construction. A
task implementation review uses the same idea at task scope: `blocked` /
`changes-required` / `pass`.

Before emitting a review, check it against its own table: an unresolved
`OWNER_DECISION`/`NEEDS_CLARIFICATION`/`AUTO_FIX` finding cannot coexist with
`ready_for_approval: true`; a non-`approved` task cannot coexist with
`implementation_allowed: true`; `approved-for-implementation` requires the task(s) to
actually carry `status: approved` right now. A report that fails its own check has a
bug — fix the verdict, don't publish the contradiction.

If a review presents an `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding as something
that could be deferred, it names the concrete consequence — resolve it now and proceed;
remove the affected scope and split it into a new task; or leave this task unapproved
while unrelated tasks proceed. "Resolve it, or defer it" is not a real option — deferring
without naming which of these three applies leaves `ready_for_approval` undefined.

Never phrase a verdict more optimistically than its row justifies — "ready for
implementation" and bare "pending" are banned; use only the five fixed values.

A specification review additionally answers, explicitly: may implementation start now?
(literally `implementation_allowed`). Are the relevant tasks actually `approved`
(checked in `change.yaml`, not assumed)? What concretely has to happen first?

### Review freshness is verified deterministically, not inferred

Time passes between a review being written and an owner acting on it, and the spec can
change in between. Approval must not proceed against a review that no longer matches
the current specification — and whether it matches must be a **computed fact**, not a
model's impression of recency. `tools/specs.mjs fingerprint <change>` prints a sha256
hash over the specification's approval-relevant inputs (manifest, overview, owner
decisions, every area/task file — sorted, deterministic), deliberately excluding the
review artifact itself so writing the review never invalidates its own fingerprint. A
review embeds this exact printed value; approval recomputes it and refuses if the two
don't match, naming both values so the mismatch is verifiable.

The retired `computeSpecFingerprint` was a single whole-spec hash — any task's status
transition changed the hash for the entire change, invalidating the stored review's
fingerprint for every other task in the same change too. `approve` now reads
`computeChangeFingerprint` (see "State model" above) instead — it excludes `status`,
`execution.suspension`, and `self_check` by construction, so a status-only or
unrelated-task edit no longer invalidates a spec review. Every `reviews/spec.md` written
under the old scheme became stale the first time this cutover shipped — a one-time,
expected re-review, not a recurring cost (see ADR-0006).

### A re-review reads current files, never infers "unchanged" from git

A real failure: a re-review saw `git status` report an untracked directory, treated
that as "nothing changed," and repeated findings that had already been fixed. An
untracked directory carries zero file-level diff information — it is not evidence
either way. The rule: **every review, first-time or repeat, fully re-reads the actual
current content of every file it evaluates.** Never infer "unchanged" from an untracked
directory, a clean `git status`, the absence of a `git diff`, or conversation memory.

The real baseline for a re-review is the previous review *file itself* — read before it
gets overwritten, not git. If none exists yet, say so verbatim: "No reliable
previous-file baseline is available. Performing a fresh review of the current
specification." Before repeating any baseline finding, re-verify its exact predicate
against the file it refers to, right now — e.g. actually re-open the task file and
check its current `forbidden_paths` list, don't rely on what a prior review said it was.
A finding resolved since the baseline is reported as resolved, not repeated as an
active blocker, and the verdict is always computed from the current run's findings, not
carried forward.

### Gating versus non-gating checks

`tools/specs.mjs validate` / `tools/docs.mjs validate` are gating — a failure makes the
verdict `blocked`. `tools/specs.mjs check` / `tools/docs.mjs check` are not — they check
whether *repository-wide* generated indexes are current, which can fail because of a
completely unrelated change, not the one under review. Run them, report the result, but
never let a `check` failure change the verdict; label the two results separately
("Gating validation: passed", "Non-gating repository check: failed — <reason>") so the
reader never has to guess why one failure mattered and the other didn't.

### A favorable verdict still isn't a status change

Reaching `ready-for-approval` doesn't end the process with an instruction to hand-edit
`change.yaml` — the next step is an explicit, interactive confirmation (in Claude Code:
`/nevo-ai:spec-approve`) that asks the owner directly and only writes `approved` after
an answer, and whose gate (review exists, verdict ready, nothing unresolved, fingerprint
current) is enforced by the CLI, not by an agent's judgment call. Approving a task and
starting its implementation are always two separate, separately-confirmed *underlying
transitions* — `approve` and `start` are never combined into one operation, and a
successful `approve` is never rolled back if `start` then fails (D3). `spec-approve`'s
fourth outcome, "approve and start," is the one place a single owner confirmation runs
both in sequence: its own explicit, separately-labeled menu item (never the default,
never inferred), re-checking `start`'s postconditions against *current* state before
running it. A `confirm-required` stop inside that sequence resumes in place after one
confirmation rather than ending the flow (D17) — see "Recovery and the resume-and-continue
controller" below.

### The response ends with a short, structured summary, not the full report

The conversation gets a short, clearly formatted block — verdict, the relevant
booleans/counts as a short bulleted list (not a single dense `Key: value · Key: value`
line, which is hard to scan and renders poorly in Markdown-capable tools), the
artifact's path, and one exact next command in its own block — not a restatement of the
full report. The full analysis lives in the file from the previous section.

### Review feeds refinement without manual copying

A `changes-required` specification review's natural next step applies its own
`AUTO_FIX` findings directly and stops only at `OWNER_DECISION`/`NEEDS_CLARIFICATION`
ones — reading the review file itself rather than requiring anyone to retype or paste
findings into a follow-up request. (In Claude Code: `/nevo-ai:spec-refine <change-id> --from-review`.) After any such pass, re-review rather than trusting the pre-fix
verdict — a stale review file describing the old state is worse than no file.

A task review's equivalent is a single batch confirmation, not per-finding: every
`AUTO_FIX` finding is already pre-authorized by its category ("the agent may make this
fix without further deliberation once told to proceed"), so the one thing still needed
is being told to proceed — once, for the whole batch, not fixing code silently on the
strength of the category alone. (In Claude Code: `/nevo-ai:task-apply-review <change-id> <task-id>`.) It then re-runs the task review itself against the changed
diff, so "fix, then remember to re-review" is one command instead of a manual two-step
the owner has to drive. `OWNER_DECISION`/`NEEDS_CLARIFICATION`/`NON_BLOCKING` findings
are never auto-applied — they're shown, not silently dropped, but still need the owner
directly.

### Change-wide audits are a third, distinct review shape

A spec review gates approval readiness; a task review gates one task's diff against its
own acceptance criteria. Neither fits "look across an already-`implemented` change
through one named lens" (e.g. "are the examples genuinely useful and wired end-to-end?")
— that request touches many tasks at once and gates nothing. Without a defined shape for
it, an agent asked to do this has nothing to reuse and will improvise a non-standard
verdict value or an invented task field — a real failure this document exists to
prevent, not a hypothetical one.

The fix is the same pattern as everywhere else in this document: give it its own,
smaller, explicitly-defined shape rather than leaving it to improvisation. A change-wide
audit:

- never re-evaluates any task's own acceptance criteria (already gated by that task's
  own review),
- writes to `specs/active/<change-id>/reviews/audit-<slug>.md` — never
  `reviews/<task-id>.md`, which would make it indistinguishable from a task review,
- uses its own three-value verdict — `owner-decision-required` \|
  `changes-recommended` \| `no-findings` — computed from a table the same way every
  other verdict in this document is, never composed as prose,
- carries a second, independent, manually-set field, `audit_status`
  (`open` \| `actioned` \| `dismissed`), tracking whether its recommendations were acted
  on since — separate from `verdict`, which only describes the findings as of that write,
- hands off a recommended follow-up (usually a new task, added via the normal
  specification-and-implementation-are-separate-steps rule above) rather than ever
  applying a fix itself.

In Claude Code this is `/nevo-ai:spec-audit <change-id> <focus>`. Cursor, Copilot, and
any terminal-driven use follow the same shape directly: write the report by hand using
the fields above, under the same `reviews/audit-<slug>.md` path, so the artifact means
the same thing regardless of which tool produced it.

### Finalizing: the step after every task is verified

Archiving a change (`node tools/specs.mjs archive <change>`) only ever checks local task
status — it has no knowledge of git or GitHub, so a change can be archived while its
commits sit on a branch that was never pushed, never opened as a PR, or never merged.
`node tools/specs.mjs finalize <change>` closes that gap with the same "deterministic
gate, then an explicit owner confirmation" pattern used for approval: `validateFinalize`
(pure, in `tools/specs/lifecycle.mjs`) checks, in order —

1. every task is in a terminal status,
2. the working tree is clean and the branch is fully pushed (not behind, not ahead of
   its remote),
3. a pull request exists for the branch, is not a draft, and is `OPEN` (or already
   `MERGED` — idempotent no-op, same convention as the other lifecycle transitions),
4. every PR review thread is resolved — from any reviewer, including bot reviewers like
   GitHub Copilot; nothing distinguishes a bot's unresolved comment from a human's,
5. verification commands are green: `specs.mjs`/`docs.mjs` validate and check, plus
   `dotnet build`/`dotnet test` when the branch actually touches `src/**`/`tests/**`
   (skipped, and said so, for a docs-only or tooling-only change).

`node tools/specs.mjs finalize <change> --check` reports this gate's result with no
side effects at all. The gate also blocks on any open, `blocking`-severity
`follow-ups.yaml` entry, exactly like a non-terminal task. Without `--check`, once the
gate passes, `finalize` runs: **verify → archive locally → commit → push → merge →
verify-before-cleanup → delete branch**, never run without the owner's explicit
go-ahead — in Claude Code, `/nevo-ai:spec-finalize <change-id>` is that confirmation
layer (CLI enforces the gate, conversation captures the human decision). Merging is this
workflow's highest-consequence transition — shared state, hard to fully undo — so this
is the one place a favorable gate result is *never* enough by itself; see `AGENTS.md`'s
git-safety rules.

**Verify-before-destructive-cleanup (D9).** The squash-merge itself no longer deletes
the branch in the same call — branch deletion is gated on a *second*, post-merge check.
After merging: `finalize` fetches and fast-forwards local `main`, runs the cheap
post-merge check (`specs.mjs`/`docs.mjs` `check` only — no duplicate `dotnet build`/`dotnet test`), and only if it passes deletes the branch (local + remote). On
failure: it reports the merged SHA, the failed check, and preserves the branch as a
**diagnostic anchor** (D23 — it doesn't itself repair `main`, it's just not deleted);
no `follow-ups.yaml` entry is written for the now-archived change, since that would
mutate an already-finalized artifact with no commit path.

**Guarded repair branch (D23, ordered by D25).** After a post-merge failure, one
explicit owner confirmation offers to create `fix/<change>-post-merge`
(`node tools/specs.mjs finalize-repair-branch <change> --failing-sha <sha>`). On
confirmation, a nine-step sequence runs immediately before creating the branch — every
read-only/remote check (worktree clean, local/remote repair-branch absence,
`origin/main` still at the recorded failing SHA) completes *before* switching or
fast-forwarding local `main`; only then does it check that local `main` actually landed
on the failing SHA, and only then create the branch. A guard failing before the `main`
switch reports at most a completed read-only `fetch`; a guard failing after it states
precisely that the switch/fast-forward already happened — never "nothing was modified"
when something was. Never `reset`/`clean`/force-checkout/automatic-stash at any step;
never overwrite an existing repair branch. The repair itself (editing files, running
the targeted checks, opening the repair PR) stays manual beyond branch creation.

## Architecture documentation and ADRs

`docs/development/` describes **current** behavior, not desired future state.
Experimental or incomplete modules must be marked as such rather than presented as
stable. A specification that changes durable architectural decisions must say so
explicitly and call out the ADR(s) it affects; new durable decisions are recorded as new
ADRs in `docs/decisions/` (see `ADR-0001` for the commit-message convention this repository
follows, and `ADR-0002` for the workflow itself). Superseding an ADR is an owner
decision, not an inference.

## Active versus archived specifications

`specs/active/` holds every change currently being discovered, specified, or
implemented. `specs/archive/` holds changes whose tasks are all in a terminal status.
Archived specs are not loaded by default — only when a task explicitly references one,
when historical reasoning is requested, or when an ADR or active spec requires it. Never
start a task from `specs/archive/`.

Every task reaching a terminal status does not archive a change by itself — that would
silently foreclose follow-up work (another review pass, a task someone still means to
add) without ever asking. Whichever tool-adapter action marks a change's last task
terminal is responsible for offering to archive it right then, as an explicit,
interactive confirmation — not a standing instruction to run later. In Claude Code, that
is `/nevo-ai:task-review`; `/nevo-ai:task-next` is a read-only backstop that surfaces
(never archives) a fully-terminal change still sitting in `specs/active/`. Cursor,
Copilot, and any terminal-driven use of `tools/specs.mjs` follow the same rule directly:
after `verify`/`complete` leaves every task in a change terminal, ask the owner whether
to run `node tools/specs.mjs archive <change>` before moving on, rather than leaving the
change active indefinitely.

## Git safety

- No commit, push, or pull request without explicit owner instruction.
- Never `--no-verify`, never force-push.
- No drive-by refactoring outside a task's `allowed_paths`.
- Branches are created via `tools/specs.mjs start`, not by hand, except where an agent
  has been explicitly authorized to create one outside the specs lifecycle.
- Show the diff and verification results before asking to commit.

Full detail: `docs/development/git-workflow.md` and `docs/development/commit-conventions.md`.

## Tool adapters

This document is the shared policy. Tool-specific layers are thin:

- **Claude Code** exposes `/nevo-ai:spec-create`, `/nevo-ai:spec-refine`,
  `/nevo-ai:spec-review`, `/nevo-ai:spec-approve`, `/nevo-ai:spec-audit`,
  `/nevo-ai:spec-resolve-comments`, `/nevo-ai:spec-finalize`, `/nevo-ai:spec-status`,
  `/nevo-ai:task-next`, `/nevo-ai:task-start`, `/nevo-ai:task-review`, and
  `/nevo-ai:task-apply-review` (see `.claude/commands/nevo-ai/`), backed by the shared
  skill `.claude/skills/nevo-ai-spec-workflow/`. These commands call the same
  `tools/specs.mjs` / `tools/docs.mjs` CLIs described above — they do not implement a
  parallel workflow. `/nevo-ai:spec-status <change-id>` is the one command that spans
  the whole chain read-only — reach for it any time the next step isn't obvious, instead
  of reasoning through every other command's own narrower "Next command" field.
- **Cursor** and **Copilot** have no namespaced commands. They follow this document and
  `AGENTS.md` directly, driving `tools/specs.mjs` / `tools/docs.mjs` from the terminal.

No agent — regardless of tool — may invent an owner decision that this document requires
to be asked explicitly.
