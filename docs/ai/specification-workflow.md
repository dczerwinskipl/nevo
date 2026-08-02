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
---

# NEvo specification workflow

This document is the single vendor-neutral source of truth for how AI agents plan and
execute changes in this repository. It applies equally to Claude Code, Cursor, GitHub
Copilot, and any other tool. Tool-specific adapters (`CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, and Claude's `/nevo-ai:*` commands) point here instead
of duplicating it.

The process itself — and the decision to build a lightweight custom workflow instead of
adopting an external framework — is recorded in
[ADR-0002](../adr/ADR-0002-lightweight-markdown-workflow.md).

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

When in doubt between two classes, prefer the smaller one and let refinement upgrade it
if the owner's decisions turn out to require more structure.

### Signal-based classification

Judgment calls on S/T/A/E drift over time without a shared basis. Before classifying,
evaluate the change against these technical signals — each rated GREEN (clearly yes,
with evidence), YELLOW (uncertain — state what's missing), or RED (clearly no /
contested):

| Signal | Question |
|---|---|
| Behavioral clarity | Is the expected behavior fully determined by existing tests, docs, or an established pattern already used elsewhere in the codebase? |
| Public surface impact | Does the change avoid altering any public API, contract, or a package's exported surface? |
| Package boundary impact | Is the change contained within one package/project, introducing no new inter-package dependency (see `docs/architecture/package-boundaries.md`)? |
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
- existing documentation (`docs/architecture/`, `docs/development/`, `docs/adr/`),
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
`docs/architecture/package-boundaries.md` for the current boundaries):

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
`allowed_paths`, and `forbidden_paths` in its front matter. `tools/specs.mjs context
<change> <task>` resolves this into a JSON packet. Agents load `required` context before
touching code, load `optional` only if the task text references it, and treat
`allowed_paths`/`forbidden_paths` as a hard scope boundary — not a suggestion. This is
what keeps large specifications from forcing every task to read the entire change.

## Using `tools/specs.mjs`

```
node tools/specs.mjs generate                  # rebuild specs/*.generated.*
node tools/specs.mjs validate                  # validate all change manifests
node tools/specs.mjs check                     # validate + verify indexes are current
node tools/specs.mjs list                      # list active changes and task statuses
node tools/specs.mjs next                      # next approved, dependency-ready task → JSON
node tools/specs.mjs context <change> <task>   # context packet for one task → JSON
node tools/specs.mjs fingerprint <change>      # deterministic hash of the spec inputs (for review freshness)
node tools/specs.mjs approve <change> <task>   # mark task approved — requires draft status and a current, ready, fully-resolved review
node tools/specs.mjs start <change> <task>     # create/switch branch, set task in-implementation
node tools/specs.mjs complete <change> <task>  # mark task implemented
node tools/specs.mjs verify <change> <task>    # mark task verified (owner-reviewed)
node tools/specs.mjs archive <change>          # move a fully terminal change to specs/archive/
```

`start` refuses to run on a dirty working tree. `next` only ever returns a task whose
status is `approved` and whose dependencies are all in a terminal status
(`implemented`, `verified`, `archived`, `abandoned`) — task selection is never a manual
scan of spec files.

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
starting its implementation are always two separate, separately-confirmed actions —
there is no combined "approve and start" shortcut, even when both are what the owner
ultimately wants; each step is invoked on its own.

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
findings into a follow-up request. (In Claude Code: `/nevo-ai:spec-refine <change-id>
--from-review`.) After any such pass, re-review rather than trusting the pre-fix
verdict — a stale review file describing the old state is worse than no file.

A task review's equivalent is a single batch confirmation, not per-finding: every
`AUTO_FIX` finding is already pre-authorized by its category ("the agent may make this
fix without further deliberation once told to proceed"), so the one thing still needed
is being told to proceed — once, for the whole batch, not fixing code silently on the
strength of the category alone. (In Claude Code: `/nevo-ai:task-apply-review
<change-id> <task-id>`.) It then re-runs the task review itself against the changed
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
side effects at all. Without `--check`, once the gate passes, `finalize` archives the
change locally, commits and pushes that archive commit, then squash-merges the PR
(matching this repository's documented merge strategy — see `git-workflow.md` §
"Merge strategy") and deletes the branch: **verify → archive locally → commit → push →
merge**, all inside one command, but never run without the owner's explicit go-ahead —
in Claude Code, `/nevo-ai:spec-finalize <change-id>` is that confirmation layer, the
same split used everywhere else in this document (CLI enforces the gate, conversation
captures the human decision). Merging is this workflow's highest-consequence
transition — shared state, hard to fully undo — so this is the one place a favorable
gate result is *never* enough by itself; see `AGENTS.md`'s git-safety rules.

## Architecture documentation and ADRs

`docs/architecture/` describes **current** behavior, not desired future state.
Experimental or incomplete modules must be marked as such rather than presented as
stable. A specification that changes durable architectural decisions must say so
explicitly and call out the ADR(s) it affects; new durable decisions are recorded as new
ADRs in `docs/adr/` (see `ADR-0001` for the commit-message convention this repository
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
  `/nevo-ai:spec-finalize`, `/nevo-ai:task-next`, `/nevo-ai:task-start`,
  `/nevo-ai:task-review`, and `/nevo-ai:task-apply-review` (see
  `.claude/commands/nevo-ai/`), backed by the shared skill
  `.claude/skills/nevo-ai-spec-workflow/`. These commands call the same
  `tools/specs.mjs` / `tools/docs.mjs` CLIs described above — they do not implement a
  parallel workflow.
- **Cursor** and **Copilot** have no namespaced commands. They follow this document and
  `AGENTS.md` directly, driving `tools/specs.mjs` / `tools/docs.mjs` from the terminal.

No agent — regardless of tool — may invent an owner decision that this document requires
to be asked explicitly.
