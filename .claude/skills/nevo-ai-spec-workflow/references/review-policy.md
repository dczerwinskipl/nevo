# Review policy

## Findings must be actor-classified

Every finding a review produces — spec-level or task-level — is tagged with exactly one
category, so the reader (human or the next command) knows who acts on it without having
to interpret prose:

| Category | Meaning | Who acts |
|---|---|---|
| `AUTO_FIX` | Mechanical, unambiguous correction — a missing `forbidden_paths` entry, a broken relative link, a missing required frontmatter field. No judgment call, no scope/behavior change. | Agent, directly — no owner decision needed |
| `OWNER_DECISION` | Falls under an owner-approval gate (`AGENTS.md`) or otherwise changes scope/behavior/architecture. | Owner must decide |
| `NEEDS_CLARIFICATION` | The reviewer can't finish the finding without more information (e.g. "which file should this task target?"). | Owner must answer before it can even become a fix |
| `NON_BLOCKING` | Real but doesn't block readiness/approval — style, a missing "nice to have" section, a follow-up suggestion. | Optional, owner's call whether to act now or later |
| `INFORMATIONAL` | Not a finding to act on — confirms something is already correct (validation clean, dependency graph acyclic). | No one — context only |

A finding with no category is not a finished finding. `AUTO_FIX` still gets reported,
never applied silently by the review command itself (review stays read-only — see
below); it's a green light for whoever runs the follow-up fix, not permission to skip
telling the owner what changed.

## Re-review: current file contents are the source of truth, not git status or memory

A real failure already happened from this: a re-review saw `git status --porcelain`
return `?? specs/active/<change>/` (an **untracked directory** — which carries zero
file-level diff information, not "nothing changed"), concluded nothing had changed, and
repeated stale findings that had already been fixed. The rule this section exists to
enforce: **every review execution, first-time or repeat, fully re-reads the actual
current content of every file it evaluates.** There is no shortcut.

### Never infer "nothing changed" from any of these

- an untracked directory in `git status`,
- a clean `git status` in general,
- the absence of a `git diff`,
- the current conversation's memory of a previous review or previous turns.

None of these are evidence about file contents. `git status`/`git diff` are not part of
this mechanism at all — not "usually right, sometimes wrong," just not the tool for
this job. Direct content inspection is: `Read` the file, every time.

### The real baseline is the previous review file, read before it's overwritten

Before writing a new `reviews/spec.md` (or `reviews/<task-id>.md`), read its **existing**
content, if the file already exists — that prior file is the baseline, not git. If no
such file exists yet, there is no baseline. Say so, verbatim:

> No reliable previous-file baseline is available. Performing a fresh review of the
> current specification.

Do not silently treat "no baseline" the same as "nothing to compare" and skip past it —
the sentence above must appear in that case so the reader knows a fresh review ran, not
a diff against something that doesn't exist.

### Findings have a lifecycle, on top of their actor category

Actor category (`AUTO_FIX`/`OWNER_DECISION`/.../`INFORMATIONAL`) says who acts on a
finding. **Lifecycle** says what happened to a *previous* finding since the baseline —
a second, independent axis, only populated when a baseline exists:

| Lifecycle | Meaning |
|---|---|
| `resolved` | The exact predicate that made this a finding is no longer true, verified against current content |
| `still-present` | The predicate is still true, unchanged |
| `changed` | Related content changed, but the finding needs fresh evaluation — a partial fix, or the fix took a different shape than expected |
| `cannot-verify` | The referenced file/section no longer exists, or the original predicate can't be checked as written — say why |

Before repeating any baseline finding, verify its **exact, literal predicate** against
the file it refers to, right now — not "I recall this was missing." Concretely: if the
predicate is "`docs/development/architecture-overview.md` is present in `forbidden_paths`," open the
task file and check the actual `forbidden_paths` list; if it's "the ADR decision is
recorded," open `owner-decisions.md` and check for that entry. A finding is only
`still-present` if this direct check, performed this run, confirms it.

New findings for the current run are computed independently by inspecting the current
specification from scratch — the baseline is a checklist of what to re-verify, never a
substitute for looking for anything new.

### Extra consistency checks for a re-review

In addition to the checks in "Consistency validation" above:

- A finding classified `resolved` this run must not also appear as an active,
  unresolved item feeding the verdict decision table — that would be a direct
  contradiction of the lifecycle classification just assigned to it.
- A decision that is actually present in `owner-decisions.md` must not be reported as
  an unanswered `OWNER_DECISION` finding — check the file, don't assume it's still open
  because an earlier review said so.
- The verdict is computed from **this run's** current findings only. Never carry
  forward a previous verdict, even if every baseline finding classifies as `resolved` —
  recompute from row 1 of the decision table.

### What the artifact stores, to make the next re-review possible

For every finding, the report (`templates/review-report.md`) records: ID, the affected
file, the exact predicate being verified (not a paraphrase), lifecycle status (previous
→ current, when a baseline existed), and the evidence — a concrete quote or fact from
the current file — that justifies the current classification. This is what makes the
review artifact itself a real baseline for the *next* re-review, independent of git
tracking status.

## Deterministic review freshness — the spec fingerprint

A review answers "is the spec ready right now" — but time passes between writing the
review and the owner acting on it, and the spec can change in between. `/nevo-ai:
spec-approve` (backed by `node tools/specs.mjs approve`) refuses to approve a task
against a review that no longer matches the current specification state. That
freshness check must be **deterministic**, never inferred by a model reasoning about
"does this look recent" — an LLM cannot reliably compute or verify a hash by reasoning,
so the mechanism has to be a real, run tool, not a judgment call.

Concretely: `node tools/specs.mjs fingerprint <change>` prints a sha256 hash over the
specification's approval-relevant inputs (`change.yaml`, `overview.md`,
`owner-decisions.md`, every file under `areas/` and `tasks/`, sorted for determinism) —
**excluding `reviews/**` entirely**, so writing the review file never invalidates its
own fingerprint. `/nevo-ai:spec-review` must run this command and copy its exact
printed output, verbatim, into the review's `spec_fingerprint` frontmatter field —
never estimate, paraphrase, or recompute it by hand. `tools/specs.mjs approve`
independently re-runs the same computation at approval time and rejects the approval if
the two hashes don't match, naming both values in the error so the mismatch is
verifiable, not just asserted.

## Persistent artifact and handoff

A review is not just conversation output — it produces a file, so the next command
(`/nevo-ai:spec-refine --from-review`, a follow-up `/nevo-ai:task-review`, or the owner
re-reading it later) has something durable to act on instead of scrollback:

- `/nevo-ai:spec-review <change>` writes `specs/active/<change>/reviews/spec.md`.
- `/nevo-ai:task-review <change> <task>` writes
  `specs/active/<change>/reviews/<task-id>.md`.

Each file is overwritten on every run — it represents the *current* review, not a
history. Git already tracks the history of the file itself; don't build a second,
in-repo versioning scheme on top of that (see ADR-0004). Writing this one file is the
single exception to "review is read-only" — a review command never edits the change,
task, or spec files it is reviewing.

Every review ends with the structured chat summary defined below — not just the full
report (which lives in the file). See `templates/review-report.md` for how the full
report itself is laid out, and `docs/ai/specification-workflow.md` § "Review artifacts
and handoff" for the vendor-neutral version of this policy.

## Chat output shape

The detailed review stays in the artifact file. The chat response is a short,
structured operational handoff — never a single dense line of `Key: value · Key:
value` pairs, which is hard to scan and renders poorly in the Claude Code extension.
At most one short explanatory paragraph may precede the structured block below; never
repeat the full report in the chat response.

### `/nevo-ai:spec-review` — exact required shape

```markdown
## Review result

**Verdict:** `<verdict>`

- Ready for approval: **Yes/No**
- Implementation allowed: **Yes/No**
- Unresolved required fixes: **<count>**
- Unresolved owner decisions: **<count>**
- Needs clarification: **<count>**

### Required action

<One concise description of the remaining action. Omit this section entirely when no
action remains — do not write "none" in its place.>

**Report:** `<artifact path>`

**Next command:**

​```text
<exact command>
​```
```

When there is no next command, the fenced block reads exactly:

```text
No further action required.
```

Formatting rules:

1. Never place all status fields on one line.
2. Do not use middle-dot- or pipe-separated status summaries.
3. Use inline code (backticks) only for identifiers, file paths, verdict values,
   finding IDs, and commands.
4. Use bold text for **Yes** and **No**.
5. Keep detailed evidence, validation logs, and finding analysis in the persistent
   review artifact — not the chat response.
6. At most one short explanatory paragraph before the structured block.
7. Keep the summary compact enough to fit on one screen.
8. Do not repeat the full report in the chat response.
9. Put the exact next command in a fenced ` ```text ` block.
10. When there is no next command, use the literal sentence above — not `none`, not a
    dash, not an empty block.

**Example — changes required:**

```markdown
## Review result

**Verdict:** `changes-required`

- Ready for approval: **No**
- Implementation allowed: **No**
- Unresolved required fixes: **1**
- Unresolved owner decisions: **0**
- Needs clarification: **0**

### Required action

Update `areas/07-developer-and-validation.md` so it reflects owner decision `D7`.

**Report:** `specs/active/nevo-documentation-foundation/reviews/spec.md`

**Next command:**

​```text
/nevo-ai:spec-refine nevo-documentation-foundation --from-review
​```
```

**Example — ready for approval:**

```markdown
## Review result

**Verdict:** `ready-for-approval`

- Ready for approval: **Yes**
- Implementation allowed: **No**
- Unresolved required fixes: **0**
- Unresolved owner decisions: **0**
- Needs clarification: **0**

**Report:** `specs/active/nevo-documentation-foundation/reviews/spec.md`

**Next command:**

​```text
/nevo-ai:spec-approve nevo-documentation-foundation doc-taxonomy-and-tooling
​```
```

### `/nevo-ai:task-review` — adapted shape

Same spirit, this command's own fields (no `ready_for_approval`/`implementation_allowed`
booleans — those are spec-level concepts):

```markdown
## Task review result

**Verdict:** `<pass|changes-required|blocked>`

- Blocking findings: **<count>**
- Non-blocking findings: **<count>**

### Required action

<omit if none>

**Report:** `<artifact path>`

**Next command:**

​```text
<exact command, or "No further action required.">
​```
```

Do not duplicate this formatting contract in any command file — `spec-review.md` and
`task-review.md` reference this section instead of restating the template.

## Change-wide audits

`/nevo-ai:task-review` gates one task's diff against its own acceptance criteria.
`/nevo-ai:spec-review` gates a whole spec's readiness for approval. Neither fits a third,
real shape of request: "look across an already-`implemented` change through one named
lens" (e.g. "are the examples genuinely useful and wired end-to-end, or copy-pasted
fragments?"). Before this section existed, that request had no defined artifact shape,
and an agent handling it improvised a non-standard `verdict` value and a `task:` field
that didn't name a real task — exactly the inconsistency this section exists to prevent.
`/nevo-ai:spec-audit <change-id> <focus>` is the one command for this shape of request.

A spec-audit never re-evaluates any task's own acceptance criteria — those were
already gated by that task's own `/nevo-ai:task-review` pass. It looks across the whole
change (or the subset `<focus>` implicates) for something *outside* any single task's
acceptance-criteria text.

### File naming

`specs/active/<change-id>/reviews/audit-<slug>.md`, where `<slug>` is a short kebab-case
derivation of the owner's focus (e.g. `audit-examples-and-wireup.md`). Never
`reviews/<task-id>.md` — that path means a task review, and a colliding name would make
an audit indistinguishable from one at a glance.

### Verdict decision table

Evaluate top to bottom; the first matching row wins. This table is deliberately
different from spec-review's and task-review's — an audit never gates approval or a
diff, it only recommends:

| # | Condition | Verdict |
|---|---|---|
| 1 | Any finding requires an owner decision before it can even be scoped as a task | `owner-decision-required` |
| 2 | No `OWNER_DECISION`/`NEEDS_CLARIFICATION` findings, but at least one `AUTO_FIX` or `NON_BLOCKING` finding exists | `changes-recommended` |
| 3 | No unresolved findings of any actionable category | `no-findings` |

`NON_BLOCKING` participates in this table (unlike spec-review's/task-review's tables) —
an audit has nothing to gate, so there is no reason to exclude a real, non-blocking
observation from `changes-recommended`.

### `audit_status` — a second, independent axis

`verdict` describes the findings *at the moment the audit was written*. `audit_status`
tracks whether anything has been done about them since — a separate frontmatter field,
manually set, never computed from `verdict`:

| `audit_status` | Meaning |
|---|---|
| `open` | Default. Recommendations not yet acted on. |
| `actioned` | The recommended follow-up (usually a new task) was completed — set only via the step 8 closed-menu confirmation in `/nevo-ai:spec-audit`, on a re-audit where every baseline finding now resolves. |
| `dismissed` | The owner explicitly decided not to act on this audit's findings. |

This is not validated by `tools/specs.mjs` (which doesn't read `reviews/**`) — same as
`verdict`, it's a convention for humans and for a future `/nevo-ai:spec-audit` re-run
to parse. Setting `actioned` or `dismissed` is an owner-only transition, same principle
as marking a task `verified` or archiving a change (see "Owner-only transitions" below)
— never inferred from a favorable verdict alone.

### Chat output shape

```markdown
## Change audit result

**Verdict:** `<no-findings|changes-recommended|owner-decision-required>`

- Actionable findings: **<count>**
- Owner-decision findings: **<count>**

### Required action

<omit if none>

**Report:** `<artifact path>`

**Next command:**

​```text
<exact command, or "No further action required.">
​```
```

Do not duplicate this formatting contract in any command file — `spec-audit.md`
references this section instead of restating it.

## Spec-review verdicts are derived, never chosen narratively

The single biggest failure mode of a review command is a *locally* correct finding
("unresolved owner decision on task 12") paired with a *globally* wrong conclusion
("spec ready for owner approval") — because the verdict was composed as prose instead
of computed from the findings. This section exists specifically to prevent that. The
verdict, and the two booleans that go with it, are the output of the table below —
never a sentence the agent drafts independently and hopes is consistent with the
findings above it.

### The decision table

Evaluate top to bottom. The **first** row whose condition holds determines the verdict
— stop there, don't keep checking lower rows.

| # | Condition | `Status` | `ready_for_approval` | `implementation_allowed` |
|---|---|---|---|---|
| 1 | `node tools/specs.mjs validate` / `node tools/docs.mjs validate` fails, or two sources of truth contradict each other in a way this review can't resolve | `blocked` | `false` | `false` |
| 2 | Any unresolved `OWNER_DECISION` or `NEEDS_CLARIFICATION` finding exists | `owner-decision-required` | `false` | `false` |
| 3 | Any unresolved `AUTO_FIX` finding exists (rows 1-2 don't apply) | `changes-required` | `false` | `false` |
| 4 | No unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION` findings remain, but the relevant task(s) are not `status: approved` in `change.yaml` | `ready-for-approval` | `true` | `false` |
| 5 | No unresolved blocking findings remain, and the relevant task(s) **are** `status: approved` in `change.yaml` (checked directly, not assumed) | `approved-for-implementation` | `true` | `true` |

`NON_BLOCKING` and `INFORMATIONAL` findings never appear in this table — they cannot
change the verdict, by construction, not by discipline. Row 2 covers `OWNER_DECISION`
and `NEEDS_CLARIFICATION` findings together for the *verdict* (both produce
`owner-decision-required`), but the report and the chat summary count them
**separately** (`unresolved_owner_decisions` vs. `unresolved_needs_clarification`) —
they block the same way, but they're different things for the owner to act on.

Row 5's task-status check is a file read, not an inference from the rest of the
review's tone — a spec that "feels ready" is not the same fact as `change.yaml` saying
`status: approved`.

### Consistency validation — run before emitting the report

Before the report is shown or written, check these four statements. If any is
violated, the verdict computed above is wrong (almost always because a finding's
category or a task's actual status was misread) — fix it and recompute; never emit a
report that fails its own check:

1. An unresolved `OWNER_DECISION` or `NEEDS_CLARIFICATION` finding (`unresolved_owner_
   decisions > 0` or `unresolved_needs_clarification > 0`) cannot coexist with
   `ready_for_approval: true`.
2. An unresolved `AUTO_FIX` finding (`unresolved_required_fixes > 0`) cannot coexist
   with `ready_for_approval: true`.
3. A task with a non-`approved` status cannot coexist with `implementation_allowed:
   true`.
4. `approved-for-implementation` requires the relevant task(s) to actually carry
   `status: approved` in `change.yaml` right now.

### Deferring an owner decision has a structural consequence, name it

A review may note that an `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding could be
deferred, but never as "resolve it, or explicitly defer it" — that phrasing implies
deferring clears the blocker, and it does not. Name exactly one concrete consequence:

- resolve it now, and the whole task/change may proceed toward approval, or
- remove the affected scope from this task and split it into a separate, new task, so
  the remainder of this task can still be approved without it, or
- leave this specific task `draft`/unapproved while unrelated tasks in the same change
  proceed to approval and implementation.

"Deferred" is not a fourth option that quietly keeps `ready_for_approval: true` — it
resolves to one of the three above, each of which has a concrete, checkable effect on
the decision table.

### Forbidden phrasing

Never write "ready for implementation" (ambiguous between row 4 and row 5 above) or use
"pending" as a standalone descriptor. Use only the five `Status` values — they exist
precisely so a reader never has to interpret which of two different things a looser
phrase meant.

## Implementation readiness declaration

Every spec review explicitly answers three questions, in addition to the `Status` line
and the two booleans from the decision table above — not a restatement of the verdict
in different words:

1. May implementation start now? — literally `implementation_allowed` from the table.
2. Are the relevant tasks `approved`? — read `change.yaml`, state the actual status.
3. What, concretely, has to happen before implementation can start? — the specific
   unresolved `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION` findings, by ID (empty
   list if `implementation_allowed: true`).

## Specification readiness criteria

A spec is ready for implementation when:
- every task intended to start next has `status: approved`,
- `depends_on` references resolve and are not cyclic (`node tools/specs.mjs validate`
  checks this mechanically — run it),
- `allowed_paths` / `forbidden_paths` are present and unambiguous for every task,
- acceptance criteria are testable (a build/test/behavior check can confirm them — not
  aspirational language),
- no owner decision needed for the next task is still open,
- documentation impact (architecture docs, ADRs) is identified, even if deferred,
- if the change touches an owner-approval gate, it contains an actual option analysis
  (≥2 real options, trade-offs, consequences stated for tied-cost options) rather than a
  single proposed approach — see `references/solution-option-analysis.md`. A spec that
  jumped straight to one recommendation for a gated decision is not ready; flag it as
  blocking.

## Implementation review criteria

Compare the diff against: the task's acceptance criteria, its area's requirements (if
any), change-wide constraints, applicable ADRs, and architecture documentation. Check
behavior, tests, documentation impact, breaking changes, unrelated edits, generated
artifacts (`*.generated.*` should only change via the generator commands), and
verification evidence (build/test output).

## Blocking versus non-blocking findings

- **Blocking**: scope violation (edits outside `allowed_paths` or touching
  `forbidden_paths`), missing acceptance-criteria coverage, missing tests for behavior
  change, undocumented breaking change, architecture/ADR conflict not called out.
- **Non-blocking**: style nits, suggestions for a follow-up, minor documentation
  polish that doesn't affect correctness.

## Architecture drift detection

If the diff changes behavior that `docs/development/` describes, and the same branch
does not update that document, this is a blocking finding — architecture docs must
track current behavior.

## Gating versus non-gating checks

Not everything a review runs should be able to change the verdict:

- **Gating**: `tools/specs.mjs validate` and `tools/docs.mjs validate` — schema/
  consistency checks about the artifact under review. A failure here is row 1 of the
  decision table — `blocked`, full stop.
- **Non-gating**: `tools/specs.mjs check` and `tools/docs.mjs check` — whether
  *repository-wide* generated indexes are current. These can fail because of a
  completely unrelated active change that hasn't regenerated its own indexes yet — not
  this review's concern to block on. Run them, record the result as an `INFORMATIONAL`
  finding, and if it fails, say why when you can tell (e.g. "stale because
  `<other-change>` has pending, unregenerated edits") — never let it change the
  verdict.
- **Exception, task review only**: if the task's *own* diff touches `docs/**` or
  `specs/**` sources and the corresponding generated index wasn't regenerated as part
  of that same diff, that specific staleness is self-caused and *is* a blocking
  finding — distinguish "this diff should have regenerated X and didn't" (blocking)
  from "some other, unrelated part of the repo is stale" (informational, per above).

Always present gating and non-gating results as two separately labeled lines, never one
merged "check failed" statement the reader has to interpret:

```
Gating validation: passed
Non-gating repository check: failed — <reason, if known>
```

A reader should never have to work out on their own why a `check` failure didn't affect
the verdict; the report says so explicitly, every time.

## Status recommendations become an explicit confirmation, not an instruction to type

A review's job is to determine what transition is warranted — performing it is a
separate step, but "separate" means *interactively confirmed in the same command*,
not *left as a CLI command the owner has to type manually*. Concretely:

- `/nevo-ai:task-review` reaching `pass` asks a closed menu (implemented / verified /
  leave as-is) and applies the chosen transition itself, in the same turn — see that
  command's own flow.
- `/nevo-ai:spec-review` reaching `ready-for-approval` never asks this itself and never
  writes `approved` — it hands off to `/nevo-ai:spec-approve`, the one command allowed
  to write that status, which runs its own confirmation menu.

Neither review command changes status *before* an explicit answer, and neither infers a
transition silently from the verdict alone — the difference from the old rule ("just
recommend, never touch it") is that the confirmation now happens in conversation, in
the same session, instead of being left as a manual follow-up action.

## Owner-only transitions

Marking a task `approved` or `verified` still only ever happens after the owner's
explicit answer — `spec-approve` and `task-review`'s confirmation menus are how that
answer is captured and acted on, not an exception to owner control. Archiving a change
is the same principle, one level up: `task-review` reports where a fully-terminal
change actually stands (`node tools/specs.mjs status`) but never offers or performs a
bare `archive` itself — that would silently skip whatever PR/review/merge story the
change still has open, which is exactly the mistake this section exists to prevent (see
`docs/ai/workflow-overview.md` for the concrete incident this was fixed after).
`/nevo-ai:spec-finalize`'s own confirmation menu is what actually archives (and merges).
No command infers or defaults to a status change from silence, a favorable verdict, or
elapsed time.

Merging a PR is the highest-consequence transition in this workflow — shared, hard to
fully undo, and explicitly named in `AGENTS.md`'s git-safety rules as needing explicit
instruction every time. `/nevo-ai:spec-finalize` never merges on the strength of its
own `--check` gate alone: the deterministic gate (`node tools/specs.mjs finalize
--check`, backed by `validateFinalize`) only establishes that merging *would* be safe —
whether it happens is still the owner's explicit answer to that command's own closed
menu, the same split used everywhere else in this section (CLI enforces the gate,
conversation captures the human decision).
