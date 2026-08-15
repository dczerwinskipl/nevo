# Solution options — dashboard-loading-and-progress

## Context

`changeView.groups` and `generatedFiles` config (area `changes-grouping-and-filtering`)
need to match file paths against glob patterns (`**`, `*`, literal segments) —
first-match-wins grouping and generated/lockfile filtering, deterministic, no AI. No
glob-matching library is a direct dependency today (`picomatch` appears only
transitively, in `tools/dashboard/package-lock.json`). This touches the
`AGENTS.md` "New external dependencies" owner-approval gate (D1), so a real option
analysis is required before a direction is recommended.

## Options

### Option 1: Hand-rolled minimal matcher

- **Proposed because:** the documented example patterns in the owner's request use only
  `**`/`*` wildcards and literal segments — no negation, no brace expansion, no extglob —
  so a small, purpose-built matcher fully covers the stated need without a new
  dependency.
- **What changes / what stays the same:** a new internal `matchPath(pattern, path)`
  utility (~60-120 lines + tests) inside `tools/dashboard`; nothing else changes.
- **Complexity:** S.
- **Trade-offs considered:**
  - implementation cost: low — narrow grammar, testable exhaustively.
  - maintenance cost: ongoing — NEvo owns correctness of glob semantics forever
    (`**` across separators, trailing-slash handling, case sensitivity on Windows vs.
    POSIX).
  - coupling/cohesion: none added — no new package boundary.
  - reversibility: fully reversible, nothing to later remove.
  - public-API risk: none.
  - test/regression scope: self-contained unit tests.
  - performance: negligible either way at this scale.
  - pattern consistency: consistent with NEvo's stated posture of not reinventing
    generic infra *only when* an existing solution is free — here the "existing
    solution" is itself a new dependency, which this workflow treats as a cost, not a
    default win.
  - migration cost: N/A now; non-zero later if extended glob syntax (negation, braces)
    is ever needed.
- **Coupling/boundary check result:** no new package dependency, no boundary change.
- **Unlocks:** zero-dependency footprint for this feature; no supply-chain surface
  added.
- **Forecloses:** silently supporting negation/brace/extglob syntax if a project's
  config ever needs it — would require a follow-up change to swap in a real matcher.
- **Good fit when:** the pattern grammar needed is genuinely bounded (as it is here,
  per the owner's own worked examples). **Bad fit when:** config authors are expected to
  write arbitrary, full glob syntax immediately.

### Option 2: Add `picomatch` as a new direct dependency

- **Proposed because:** a small, well-tested, widely-used glob library removes the
  matcher-correctness burden from NEvo entirely and supports full glob semantics
  (negation, brace expansion, character classes) from day one.
- **What changes / what stays the same:** `tools/dashboard/package.json` gains
  `picomatch` under `dependencies`; the changes-grouping area calls it directly instead
  of a hand-rolled matcher.
- **Complexity:** S.
- **Trade-offs considered:**
  - implementation cost: trivial integration.
  - maintenance cost: lower for matcher correctness (offloaded to the library); one more
    package to keep patched/audited going forward.
  - coupling/cohesion: adds a new external dependency to `tools/dashboard` — a real,
    if small, addition to the supply-chain surface.
  - reversibility: reversible (can swap to a hand-rolled matcher later), but once
    project configs start using extended syntax the library doesn't strictly need
    (negation/braces), migrating away gets harder.
  - public-API risk: none.
  - test/regression scope: thin wrapper tests only.
  - performance: negligible either way at this scale.
  - pattern consistency: N/A.
  - migration cost: N/A now.
- **Coupling/boundary check result:** new dependency direction (`tools/dashboard` →
  `picomatch`), consistent with how `tools/dashboard` already depends on several small
  npm packages (`clsx`, `tailwind-merge`, etc.) — no boundary-direction violation, just
  a new gated dependency per `AGENTS.md`.
- **Unlocks:** full glob semantics available immediately if a project's config ever
  needs negation/brace expansion/extglob, with no future migration.
- **Forecloses:** nothing structurally — this is the more permissive option.
- **Good fit when:** config authors (across NEvo and any consumer repo using this
  dashboard) are expected to eventually want fuller glob syntax. **Bad fit when:**
  minimizing new dependencies is a hard priority regardless of cost.

A third option (a full custom classification/plugin engine) was not considered — the
owner explicitly ruled out anything beyond "simple, deterministic model" for this
concern (no AI-based classification), so there is no meaningfully distinct third
trade-off here beyond these two.

## Acceptance criteria coverage

| Criterion | Option 1 (hand-rolled) | Option 2 (picomatch) |
|---|---|---|
| Deterministic, first-match-wins grouping | Full | Full |
| Supports `**`/`*`/literal-segment patterns from the owner's examples | Full | Full |
| No AI-based classification | Full | Full |
| Config usable by a consumer repo other than NEvo | Full | Full |
| No new external dependency | Full | No |

## Recommendation

Recommended: **Option 2 (add `picomatch`)** — per the owner's explicit decision
(below), which takes priority over the acceptance-criteria-only ranking. On acceptance
criteria alone, both options satisfy every stated requirement equally (see table above,
they tie except on the dependency dimension itself); per the consequences-at-equal-cost
rule, Option 2 was recommended-to-the-owner as the safer long-term bet if config syntax
needs ever grow, at the cost of one new small dependency, while Option 1 was the
minimal-footprint alternative. The owner chose Option 2.

## Confirmation

Presented via a closed two-option question naming the trade-off (dependency vs.
zero-dependency-but-narrower-grammar) — see `owner-decisions.md` D1. Owner's answer:
"Dodaj picomatch jako nową zależność" (add `picomatch` as a new dependency).
