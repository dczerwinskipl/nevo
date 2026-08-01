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
  `/nevo-ai:spec-review`, `/nevo-ai:task-next`, `/nevo-ai:task-start`, and
  `/nevo-ai:task-review` (see `.claude/commands/nevo-ai/`), backed by the shared skill
  `.claude/skills/nevo-ai-spec-workflow/`. These commands call the same
  `tools/specs.mjs` / `tools/docs.mjs` CLIs described above — they do not implement a
  parallel workflow.
- **Cursor** and **Copilot** have no namespaced commands. They follow this document and
  `AGENTS.md` directly, driving `tools/specs.mjs` / `tools/docs.mjs` from the terminal.

No agent — regardless of tool — may invent an owner decision that this document requires
to be asked explicitly.
