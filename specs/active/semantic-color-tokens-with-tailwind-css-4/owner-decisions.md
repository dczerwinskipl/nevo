# Owner decisions — semantic-color-tokens-with-tailwind-css-4

These decisions were given prescriptively by the owner at change creation (exact token
names, hex values, contract shape, migration order, and exclusions), not derived by the
agent. They are recorded here verbatim in substance so later commands (`spec-refine`,
`task-review`) don't need to replay the original request.

## D1: Adopt a direct-value Tailwind 4 `@theme` semantic token contract

- **Question:** How should the dashboard's ~39 `:root` color variables and ~1003
  `bg-[var(--…)]`/`text-[var(--…)]`/`border-[var(--…)]` arbitrary-value occurrences
  (`tools/dashboard/ui/index.css:6-51`; 58 files under `tools/dashboard/ui`) be replaced?
- **Options considered:** (owner-supplied, not agent-generated)
  - A — Full primitive + semantic two-layer palette (duplicate every token between a
    primitive scale and semantic aliases), matching Tailwind's own default-palette shape.
  - B — Direct semantic values in `@theme`, `@theme inline` only for aliases that
    reference another theme variable, no primitive layer, no 50–950 scale (this app is
    dark-only).
- **Decision:** Option B, with the exact `@theme` contract given in the change request
  (namespace `--color-*`, `--color-*: initial` to disable Tailwind's default palette,
  enabled only once migration completes — see D5/Area `cleanup-and-enforcement`).
- **Rationale:** Owner-stated: this is a single dark theme with no light mode planned: a
  primitive layer would be unused duplication. Hex values are valid Tailwind 4 theme
  values; OKLCH conversion is explicitly out of scope unless it solves a demonstrated
  problem (none was found — the current values already meet contrast targets except the
  one flagged case, D4).
- **Consequences:** Governs `areas/theme-foundation.md` and the token contract every
  other area consumes. No new primitive/scale tokens may be introduced by any task.
- **Date:** 2026-09-03
- **Affected artifacts:** `overview.md`, `areas/theme-foundation.md`, `tasks/01-theme-contract.md`.

## D2: Canonical status/tone semantic contract

- **Question:** Should status/tone presentation stay decided per-component (current
  state — e.g. `requiresAttention` renders via the `warning` family at
  `tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx:70-91`, with
  no distinct "attention" token) or move to one central mapping?
- **Options considered:** (owner-supplied)
  - A — Leave status/tone decisions distributed across components (current state).
  - B — One central status/tone contract (`status-active` / `status-success` /
    `status-warning` / `status-error` / `status-attention` / `status-info` /
    `status-neutral` / `action-destructive`, `status-error` and `action-destructive` kept
    as separate roles even though they start with the same value) that all status-bearing
    components consume.
- **Decision:** Option B, exactly as specified, including giving `requiresAttention` its
  own `status-attention` token distinct from `status-warning` (fixes the confirmed
  mis-mapping at `work-indicator-v2.tsx:70-91`).
- **Rationale:** Owner-stated: attention (user action required) and warning (recoverable
  tool/local failure) are semantically different signals and must be visually distinct;
  scattering the decision per component is how the current mis-mapping happened.
- **Consequences:** Governs `areas/status-tone-contract.md`; every task touching a
  status/severity mapping (work-v2 severity logic, `turn-work-summary.tsx`, workflow
  lanes, `StatusCard`) must consume this one contract rather than deciding locally.
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/status-tone-contract.md`, `tasks/03-status-tone-contract.md`, `tasks/04-agent-sessions-and-work.md`, `tasks/05-specs-lanes-and-remaining-ui.md`.

## D3: Workflow lane and provider color naming, remove `--lane-accent` runtime indirection

- **Question:** `--cat-1`/`--cat-2` (`index.css:50-51`) are generic names that only mean
  "Claude" and "Antigravity" in one consumer (`agent-session-list.tsx`'s `ProviderBadge`,
  lines 49-68); workflow lanes resolve through a two-step runtime indirection
  (`lane-presentation.ts:7-14` → inline `style={{ '--lane-accent': ... }}` at
  `status-board.tsx:119,125,129` → `bg-[var(--lane-accent)]`). Keep this indirection, or
  replace both with named tokens and a static class mapping?
- **Options considered:** (owner-supplied)
  - A — Keep generic `cat-1`/`cat-2` names and the runtime `--lane-accent` CSS-variable
    indirection (current state).
  - B — Rename to `provider-claude`/`provider-antigravity`; replace lane→color
    resolution with a static mapping table (new→neutral, design→`workflow-design`,
    ready→`status-info`, implementation→`status-active`, review→`status-warning`,
    done→`status-success`) expressed directly as Tailwind utility classes, removing the
    runtime custom-property indirection.
- **Decision:** Option B, exactly as specified.
- **Rationale:** Owner-stated: `cat-1`/`cat-2` don't communicate their actual meaning to
  a reader; the lane runtime-indirection is unnecessary complexity once static utility
  classes can express the same six-state mapping directly, and workflow lanes must stay
  presentation-only, not become a second domain model.
- **Consequences:** Governs `areas/specs-lanes-and-remaining-ui.md` (lanes) and
  `areas/agent-sessions-and-work.md` (provider badge rename). `lane-presentation.ts`'s
  return shape changes from a CSS-var string to something consumable by static
  className logic.
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/specs-lanes-and-remaining-ui.md`, `areas/agent-sessions-and-work.md`, `tasks/04-agent-sessions-and-work.md`, `tasks/05-specs-lanes-and-remaining-ui.md`.

## D4: Accent contrast fix — `accent-solid` is fill-only, never text-on-dark-surface

- **Question:** `#f8fafc` (`--accent-foreground`) on `#3882f6` (`--accent`) is the
  filled-button pair (`button.tsx:12`) and has insufficient contrast per the owner's
  stated ≥4.5:1 normal-text requirement. The current darker `--accent-strong`
  (`#1d4ed8`, `index.css:18`) is also used as a **text** color on dark neutral surfaces
  in two places (`specification-list.tsx:66` hover icon, `status-card.tsx:27` hover
  icon) — is that text usage acceptable to keep?
- **Options considered:** (owner-supplied)
  - A — Keep `accent-strong`/`accent-solid` usable both as a filled-control surface and
    as a text color on dark surfaces (current state, but contrast on dark surfaces is
    unverified/likely insufficient since it's a *darker* blue against a *dark*
    background).
  - B — Reserve `accent-solid` strictly for filled-control surfaces
    (`bg-accent-solid text-fg-on-accent`); any hover/text state on a dark surface keeps
    using `accent` (already the base link/active color) with an opacity modifier or
    stays unchanged, never inventing an untested new shade for text-on-dark.
- **Decision:** Option B, exactly as specified ("do not use it as text on dark neutral
  surfaces", "do not invent an untested blue shade").
- **Rationale:** Owner-stated contrast requirement; a darker blue on a dark surface is
  the opposite of what's needed for text contrast — it only works as a *fill* precisely
  because the fill is paired with light `fg-on-accent` text, not because the color
  itself is readable on dark backgrounds.
- **Consequences:** `specification-list.tsx:66` and `status-card.tsx:27` change their
  hover treatment from `text-accent-strong` (soon-to-be `accent-solid`) to an opacity
  modifier on `text-accent` (e.g. staying `text-accent` with existing motion/underline
  affordance, or `text-accent` unchanged on hover) — implementer verifies the resulting
  pair meets ≥4.5:1 against `--color-surface`/`--color-surface-raised` before picking the
  exact modifier; this is an implementation detail within the constraint above, not a
  new open decision (`AGENTS.md` gates don't cover internal component hover styling).
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/theme-foundation.md`, `areas/shared-ui-primitives.md`, `areas/agent-sessions-and-work.md`, `tasks/01-theme-contract.md`, `tasks/02-shared-ui-primitives.md`, `tasks/04-agent-sessions-and-work.md`.

## D5: Migration order, cleanup, and enforcement sequencing

- **Question:** In what order should the 9-stage migration strategy in the change
  request be executed, and when can `--color-*: initial` (disabling Tailwind's default
  palette) and the architecture-check enforcement be turned on without breaking
  in-progress work?
- **Options considered:** (owner-supplied stage order, agent decided sequencing/grouping
  only — an implementation detail, not a gated decision)
  - A — Enable `--color-*: initial` and the enforcement check early, fixing fallout
    incrementally.
  - B — Keep both off until every consuming area (shared primitives, status contract,
    agent sessions/work, specs/lanes/PRs/operations, raw white/black cleanup) is
    migrated, then flip both on in one final area as a guardrail.
- **Decision:** Option B. `--color-*: initial`, old-variable removal, and the
  architecture check are the last area (`areas/cleanup-and-enforcement.md`), executed
  after every consumer area is done.
- **Rationale:** Turning either on mid-migration would fail the build / fail the check
  against code that hasn't been migrated yet, for no benefit — the change request's own
  stage list already places variable removal (7), `--color-*: initial` (8), and the
  theme-color fix (9) last.
- **Consequences:** Task/area dependency chain: `theme-foundation` →
  `shared-ui-primitives` + `status-tone-contract` → `agent-sessions-and-work` +
  `specs-lanes-and-remaining-ui` → `storybook-and-documentation` →
  `cleanup-and-enforcement`.
- **Date:** 2026-09-03
- **Affected artifacts:** `overview.md` § Proposed architecture, all `areas/*.md` Dependencies sections.

## D6: Base branch is `feature/ai-session-issues-and-diagnostics`, not `main`

- **Question:** The change request says "start from the updated default branch after PR
  #42 is merged," but `gh pr view 42` shows PR #42 (`feature/storybook-for-nevo-ai` →
  `feature/ai-session-issues-and-diagnostics`) merged into
  `feature/ai-session-issues-and-diagnostics`, not `main` — `main`'s tip
  (`bde9d88`) does not contain PR #42 and is 54 commits behind. Which branch is the real
  base?
- **Options considered:** n/a — the change request itself resolves this explicitly:
  "Your base branch is Ai issues... (current), you can try to pull first."
- **Decision:** Base branch is the current branch, `feature/ai-session-issues-and-diagnostics`
  (pulled up to date first), not `main`. `tools/specs.mjs start` branches from whatever
  is currently checked out (`tools/lib/git.mjs`'s `createAndCheckoutBranch` takes no
  explicit base ref), so no extra `change.yaml` field is needed — the operator must be on
  `feature/ai-session-issues-and-diagnostics` (up to date with `origin`) at
  `/nevo-ai:task-start` time.
- **Rationale:** Matches the actual repository state and the owner's explicit
  instruction; `main` does not yet have the Storybook baseline this spec depends on.
- **Consequences:** The implementation branch and its PR both target
  `feature/ai-session-issues-and-diagnostics`, mirroring PR #42's own base, not `main`.
- **Date:** 2026-09-03
- **Affected artifacts:** `change.yaml` (branch config), `overview.md` § Constraints.
