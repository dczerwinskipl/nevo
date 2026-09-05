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
  other area consumes. No new primitive/scale tokens may be introduced by any task. See
  D10 for a later correction to the `@theme inline` mechanism named here — the alias
  block actually needs `@theme static inline`, not plain `@theme inline`.
- **Date:** 2026-09-03
- **Affected artifacts:** `overview.md`, `areas/theme-foundation.md`, `tasks/03-theme-contract.md`.

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
- **Clarification (added during `/nevo-ai:spec-review`):** this is **7 `StatusTone`
  values plus 1 separate `action-destructive` action role** — `status-active` and
  `status-neutral` are `@theme static inline` aliases that *implement* 2 of those 7 values, not
  additional states, and `action-destructive` is not a `StatusTone` member at all (it is
  a one-off component-variant concern, e.g. a destructive Button variant, never routed
  through the shared status-tone module). Earlier drafts of this spec described this as
  a "9-state contract," which double-counted the aliases and miscategorized
  `action-destructive` as a status. See D9 for how this affects the module's exported
  shape.
- **Second clarification (added during `/nevo-ai:spec-review`):** "all status-bearing
  components consume [the contract]" means every **domain-state → tone projection**
  must resolve to a `StatusTone` value — it does not mean every visual component must
  literally `import` `shared/status-tone.ts` and call its specific recipe functions. A
  component with its own constrained visual API (e.g. `StatusCard`'s `cva()` recipe) may
  consume the resulting semantic tokens/classes directly, as long as the domain-state
  decision upstream of it went through `StatusTone` first. Also: `transcript/projection.ts`'s
  legacy `PresentationSeverity` (`normal|warning|error`, no attention concept — it has
  no input that could carry `requiresAttention`) and Work V2's own
  `CanonicalTurnV2`/`TurnStatusV2` → tone projection (which does carry
  `requiresAttention`) are two genuinely separate domain projections, not one shared
  pipeline — see the correction to `areas/status-tone-contract.md` for the exact
  boundary.
- **Rationale:** Owner-stated: attention (user action required) and warning (recoverable
  tool/local failure) are semantically different signals and must be visually distinct;
  scattering the decision per component is how the current mis-mapping happened.
- **Consequences:** Governs `areas/status-tone-contract.md`; every domain-state →
  presentation projection (Work V2's own severity/attention logic, the legacy
  `turn-work/turn-work-summary.tsx` projection, workflow lanes) must resolve to
  `StatusTone` rather than deciding locally — but not every visual component must
  literally import `shared/status-tone.ts` itself (second clarification above);
  `StatusCard` is the confirmed example that doesn't need to.
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/status-tone-contract.md`, `tasks/05-status-tone-contract.md`, `tasks/06-agent-sessions-and-work.md`, `tasks/07-specs-lanes-and-remaining-ui.md`.

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
- **Affected artifacts:** `areas/specs-lanes-and-remaining-ui.md`, `areas/agent-sessions-and-work.md`, `tasks/06-agent-sessions-and-work.md`, `tasks/07-specs-lanes-and-remaining-ui.md`.

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
- **Affected artifacts:** `areas/theme-foundation.md`, `areas/shared-ui-primitives.md`, `areas/agent-sessions-and-work.md`, `tasks/03-theme-contract.md`, `tasks/04-shared-ui-primitives.md`, `tasks/06-agent-sessions-and-work.md`.

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

## D7: Adopt Prettier + `prettier-plugin-tailwindcss`, not Biome, as a directly-declared dependency

- **Question:** Should `tools/dashboard` gain a frontend formatter/Tailwind-class-sorter,
  and if so, which tool — and how should its adoption be separated from this change's
  semantic edits?
- **Options considered:** (owner-supplied, not agent-generated)
  - A — No formatter; rely on the transitive `prettier@3.9.6` already pulled in by
    `@tanstack/router-generator` (confirmed present but undeclared,
    `tools/dashboard/package-lock.json:9056`).
  - B — Adopt Biome as a combined formatter/linter platform.
  - C — Directly declare `prettier` + `prettier-plugin-tailwindcss` as devDependencies,
    with the exact config given, applied once as a standalone mechanical commit before
    any semantic edit.
- **Decision:** Option C, exactly as specified (config, scripts, `.prettierignore`
  content given verbatim in the change request).
- **Rationale:** Owner-stated: this change requires formatting and Tailwind class
  sorting, not adoption of a new combined formatter/linter platform (ruling out B); a
  transitive, undeclared dependency (A) is not something the project can rely on being
  present or stable in version.
- **Consequences:** Governs `areas/frontend-formatter-baseline.md`/`tasks/01-*`, and
  reorders the task graph — every task that edits `tools/dashboard` source must start
  from this task's completed, formatted baseline. No ESLint/Biome is introduced anywhere
  in this change (consistent with C4/the architecture-check's own "no new dependency"
  constraint).
- **Date:** 2026-09-03
- **Affected artifacts:** `overview.md`, `areas/frontend-formatter-baseline.md`,
  `tasks/01-frontend-formatter-baseline.md`, `change.yaml` (task graph/ordering).

## D8: Durable Tailwind class-composition contract in `react-component-guidelines.md`

- **Question:** Should this migration's component work follow an ad hoc, per-component
  approach to Tailwind class composition (as today — inconsistent `cva()` adoption:
  only `button.tsx`/`sheet.tsx` use it, `status-card.tsx` has a real variant API but
  implements it by hand; three independent status→class-string mapping helpers already
  exist: `status-label.tsx`'s `statusTone()`, `transcript/projection.ts`'s
  `computePresentationSeverity()`, and the newly-found `pull-requests/changes/status.ts`'s
  `stateTone()`), or should a durable, documented contract govern it from the start of
  this change?
- **Options considered:** (owner-supplied)
  - A — No new durable rule; each task decides class-composition approach locally
    (current, inconsistent state).
  - B — Add a documented Tailwind class-composition contract to
    `react-component-guidelines.md` (local-layout vs. `cva()`-variant vs.
    domain-state→tone→variant→utility→token projection vs. native DOM/ARIA state vs.
    `cn()` discipline vs. banned interpolated classes vs. multi-slot recipes vs.
    `@apply` scope, plus a required-inspection checklist), applied to every component
    this change touches, and route `docs/ai/task-routing.md` through it.
- **Decision:** Option B, exactly as specified, including the literal `StatusTone` union
  type (`neutral | active | success | warning | error | attention | info`) and the
  7-item "required inspection when touching a component" checklist.
- **Rationale:** Owner-stated: reuse the existing stack
  (`class-variance-authority`/`clsx`/`tailwind-merge`, already direct dependencies —
  confirmed — plus Nevo-owned Radix wrappers), do not add another styling/variants
  library; the in-repo evidence (inconsistent `cva()` adoption, three independent status
  mapping helpers, `StatusCard`'s hand-rolled variant branching) is exactly the kind of
  drift the contract exists to prevent going forward, and this migration is the natural
  point to establish it since it's already touching every one of those call sites.
- **Consequences:** Governs `areas/react-class-composition-guidelines.md`/`tasks/02-*`
  (the documentation itself) and adds concrete requirements to `tasks/04`, `05`, `06`,
  `07` (StatusCard → `cva()`; `projection.ts` as the real severity-mapping owner,
  renamed/aligned to `StatusTone`; `pull-requests/changes/status.ts` consuming the
  shared type/recipe rather than its own class strings; 5 ternary-based class
  selections converted to `cn()`) and `tasks/10-*` (interpolated-class-construction
  becomes a 5th banned pattern in the architecture-enforcement check).
- **Date:** 2026-09-03
- **Affected artifacts:** `overview.md`, `areas/react-class-composition-guidelines.md`,
  `areas/status-tone-contract.md`, `areas/shared-ui-primitives.md`,
  `areas/specs-lanes-and-remaining-ui.md`, `areas/cleanup-and-enforcement.md`,
  `tasks/02`, `04`, `05`, `06`, `07`, `10`.

## D9: Visual-parity claims — intentional semantic normalization, not pixel identity

- **Question (raised during `/nevo-ai:spec-review`):** Several places in this spec
  claimed "zero visual change" / "pixel-identical" outcomes while simultaneously
  prescribing changes that cannot produce a pixel-identical result: `StatusCard`'s
  error-banner recipe changing from 20%/8% `color-mix` mixes to 25%/10% opacity
  modifiers (a numeric change); every `color-mix(in srgb, …)` (sRGB) recipe converting
  to a Tailwind opacity modifier, which Tailwind 4 compiles via OKLab mixing (a
  different color space, not merely a syntax change); `warning-strong` text becoming
  base `status-warning`; white-alpha decorative fills becoming semantic-foreground
  opacity; and the filled-accent background's own required contrast fix (D4). Should
  the spec keep claiming pixel parity for these, or reframe them accurately?
- **Options considered:**
  - A — Keep the "pixel-identical"/"zero visual change" framing as a blanket claim and
    treat any of the above as an undocumented violation of it.
  - B — Reframe these specific, owner-prescribed recipe changes as intentional
    semantic-system normalization — verified for contrast/legibility and correctness of
    token usage, not claimed as pixel-identical — while keeping a strict, literal
    pixel-parity requirement for what genuinely doesn't change: neutral surface base
    tokens (`background`/`surface`/`surface-raised`/`surface-hover`/`border`/
    `border-strong`), typography, spacing, and any state not named in this list.
- **Decision:** Option B.
- **Rationale:** A spec cannot honestly claim both "we are converting sRGB `color-mix`
  to OKLab-mixed opacity modifiers" and "the result is pixel-identical" — those are in
  tension by construction. The owner's original migration request already prescribes
  every one of these changes explicitly (opacity-modifier convention, the D4 contrast
  fix, the `StatusCard` numeric-recipe change); the fix is to describe them honestly,
  not to avoid them.
- **Consequences:** Every task/area acceptance criterion that previously said "zero
  visual change" or required a per-task manual screenshot diff now instead: (a) requires
  neutral-surface/typography/spacing parity to hold exactly, (b) names the specific
  intentional color-recipe changes and requires they be verified for contrast/legibility
  and correct token usage rather than pixel identity, and (c) relies on durable
  Storybook tests during each task, with **one** representative final visual review
  consolidated into `tasks/09-*` rather than a screenshot pass repeated in every task.
  `tasks/03-*`'s screenshot requirement is removed outright (no consumer exists yet at
  that point in the graph, so there is nothing for a visual diff to catch — a
  build + compiled-CSS-value assertion replaces it).
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/theme-foundation.md`, `areas/shared-ui-primitives.md`,
  `areas/specs-lanes-and-remaining-ui.md`, `areas/cleanup-and-enforcement.md`,
  `tasks/03`, `04`, `07`, `09`.

## D10: `@theme static` for the direct-value token contract; Storybook must self-verify

- **Question (raised during `/nevo-ai:spec-review`):** Tailwind 4 only emits a `@theme`
  variable into compiled CSS when its own usage-detection sees the variable referenced
  somewhere it scans. The Colors foundation Storybook story (`tasks/08-*`) must display
  every documented token — including ones with no product consumer yet, or whose only
  consumer is itself dynamically constructed in a way Tailwind's detector might miss.
  Relying on incidental usage elsewhere in the product to keep a token "alive" in
  compiled CSS is fragile. How should the spec guarantee every catalogued token is
  actually present in compiled CSS?
- **Options considered:**
  - A — Plain `@theme { … }` (as originally specified) and hope product usage keeps
    every token detected; add no explicit guarantee.
  - B — Use `@theme static { … }` for the direct-value contract (forces every declared
    variable into compiled CSS regardless of detected usage), keep the two alias entries
    (`status-active`/`status-neutral`) in a plain `@theme inline` block, and add a
    Storybook test that actively asserts every catalogued token resolves to a non-empty
    computed value.
  - C (**correction, added in a later `/nevo-ai:spec-review` pass**) — same as B, except
    the alias block itself also needs `static`: `@theme static inline { … }`, not plain
    `@theme inline`. `static` and `inline` are orthogonal Tailwind 4 modifiers with
    different jobs — `inline` controls whether the generated utility substitutes the
    variable's *value* directly or keeps a `var(--...)` reference (required here, since
    these two entries alias another theme variable rather than holding a literal value);
    `static` controls whether the variable is emitted into compiled CSS regardless of
    detected usage. A plain `@theme inline` block is subject to the exact same
    usage-detection gap this decision exists to close — `status-active`/`status-neutral`
    would silently be missing from compiled CSS under the same conditions that motivated
    `static` for the direct-value block in the first place, defeating the point of B for
    those two tokens specifically.
- **Decision:** Option C.
- **Rationale:** The Colors story exists specifically to be a token catalog independent
  of product usage (`overview.md`'s Storybook requirements already say the story "must
  not depend on incidental usage elsewhere in the product," carried over from the
  original change request) — relying on Tailwind's own default usage-detection
  contradicts that goal directly, for the aliases exactly as much as for the direct
  values. `static` and `inline` both need to apply to the alias block simultaneously —
  they are not alternatives to each other.
- **Consequences:** `tasks/03-*` (`areas/theme-foundation.md`) uses `@theme static` for
  the direct-value block and `@theme static inline` for the two alias entries;
  implementation must first verify the installed `tailwindcss@^4.3.3` actually supports
  both `static` and `static inline` and escalate if not (an assumption this spec cannot
  verify without running the toolchain). `tasks/08-*`
  (`areas/storybook-and-documentation.md`) adds the token-presence Storybook test,
  covering both alias tokens as well as the direct-value tokens.
- **Date:** 2026-09-03
- **Affected artifacts:** `areas/theme-foundation.md`, `areas/storybook-and-documentation.md`,
  `tasks/03`, `tasks/08`.

## D11: Purely presentational StatusLabel boundary and feature-owned projections

- **Question:** How should `StatusLabel` (`tools/dashboard/ui/shared/ui/status-label.tsx`)
  be structured, given that it currently mixes presentation with domain awareness (raw
  session status literals, spec status, task status, stage formatting, and a deprecated
  `statusTone(status: string)` function)?
- **Options considered:**
  - A — Keep domain-aware branching inside `StatusLabel` and continue expanding it for
    new features.
  - B — Make `StatusLabel` a purely presentational primitive requiring typed `tone: StatusTone`
    and receiving rendered `children`, completely removing domain awareness (`kind`, `status`,
    `statusTone(string)`). Feature modules (`specifications`, `agent-sessions`, etc.) own
    their own status-to-tone projections and formatting. Non-status labels (e.g. lane header
    labels) must use local semantic markup instead of abusing `StatusLabel` merely for
    uppercase typography.
- **Decision:** Option B.
- **Rationale:** Preserves clean architectural boundaries. A shared UI primitive must not
  couple to domain models across different features. Removing `statusTone(string)` eliminates
  brittle fallback behavior. Feature-owned projections keep domain logic co-located with the
  owning domain.
- **Consequences:** `tools/dashboard/ui/shared/ui/status-label.tsx` becomes purely presentational.
  All call sites are updated to pass `tone` and `children`. Feature-local projections are
  created (e.g. `specStatusTone` in specifications). Obsolete tests and commented JSX are removed.
- **Date:** 2026-09-05
- **Affected artifacts:** `areas/specs-lanes-and-remaining-ui.md`, `tasks/07-specs-lanes-and-remaining-ui.md`.

## D12: Dedicated diff statistics tokens (`diff-addition`, `diff-deletion`) and lifecycle-state audit

- **Question:** How should diff additions/deletions and lifecycle states (running/in-progress)
  be styled? Should diffs use `status-success`/`status-error`, and should active lifecycle
  states use `accent`?
- **Options considered:**
  - A — Continue using `status-success`/`status-error` for diff line counts and `accent`
    for running lifecycle indicators.
  - B — Introduce dedicated semantic tokens `--color-diff-addition` and `--color-diff-deletion`
    in `@theme static inline` aliasing success/error hues, emitting `text-diff-addition` and
    `text-diff-deletion`. Audit lifecycle states to use `status-active` for running/in-implementation
    presentation, reserving `accent` for interactive controls, selections, links, and branding.
- **Decision:** Option B.
- **Rationale:** Semantic role purity: git diff additions/deletions are statistics about code
  modifications, not operational success/error statuses. Separating them prevents confusion and
  allows independent styling in the future. Similarly, lifecycle states are system statuses
  belonging to `status-active`, whereas `accent` represents user interaction and affordance.
- **Consequences:** `--color-diff-addition` and `--color-diff-deletion` added to `index.css`.
  Diff views in `file-change.tsx`, `pull-request-detail.tsx`, `pull-request-cards.tsx` migrate
  to `text-diff-addition` and `text-diff-deletion`. Session running badges, operation running rows,
  and spec implementation indicators migrate from `accent` to `status-active`.
- **Date:** 2026-09-05
- **Affected artifacts:** `overview.md`, `areas/specs-lanes-and-remaining-ui.md`, `tasks/07-specs-lanes-and-remaining-ui.md`.

## D13: Storybook story co-location, ownership, and test-utils architecture

- **Question:** How should Storybook stories and testing utilities be organized across the
  dashboard codebase?
- **Options considered:**
  - A — Keep omnibus story files (`shared-primitives.stories.tsx`, `specifications.stories.tsx`)
    and keep test helpers in `components/ui/storybook-test-helpers.ts`.
  - B — Delete omnibus stories and co-locate stories beside the component they exercise
    (`button.stories.tsx`, `badge.stories.tsx`, `card.stories.tsx`, `dialog.stories.tsx`,
    `sheet.stories.tsx`, `status-card.stories.tsx`, `progress.stories.tsx`, `loading-screen.stories.tsx`).
    Move feature-specific stories to their features (e.g. delete-session scenario to
    `features/agent-sessions/agent-session-details.stories.tsx`, split `specifications.stories.tsx`).
    Move Storybook test utilities to `tools/dashboard/.storybook/test-utils/` cleanly split
    by responsibility. Use `Meta<typeof Component>` and `StoryObj<typeof meta>`.
- **Decision:** Option B.
- **Rationale:** Co-location ensures component authors see and maintain stories alongside code.
  `components/ui` must contain only production UI primitives, not test infrastructure.
  Moving test helpers to `.storybook/test-utils/` prevents test utilities from polluting
  the production component library.
- **Consequences:** `components/ui/shared-primitives.stories.tsx` deleted. Co-located stories
  created. Helpers relocated to `tools/dashboard/.storybook/test-utils/`. Production palette
  assertions in `LiveTokenResolver` removed in favor of live custom property inspection.
- **Date:** 2026-09-05
- **Affected artifacts:** `areas/specs-lanes-and-remaining-ui.md`, `tasks/07-specs-lanes-and-remaining-ui.md`, `areas/storybook-and-documentation.md`, `tasks/08-storybook-and-documentation.md`.

## D14: Storybook foundation stories migration and comprehensive token validation

- **Question:** Which stories must be migrated to semantic color tokens, and should Storybook
  stories be subject to token architecture sweeps and lint checks?
- **Options considered:**
  - A — Only migrate `colors.stories.tsx`; exclude other stories from sweeps and checks.
  - B — Expand Task 08 to own all foundation stories (`colors.stories.tsx`, `typography.stories.tsx`,
    `smoke.stories.tsx`), migrating them to semantic Tailwind utilities and live token resolution.
    Update Task 09 and Task 10 so the final sweep and architectural scanner include stories
    as executable UI consumers, allowing narrow exceptions only for test fixtures under `.storybook/test-utils/`.
- **Decision:** Option B.
- **Rationale:** Stories are live, executable UI consumers running in Storybook and browser tests.
  Allowing legacy tokens or raw palette classes in stories would undermine design-system consistency
  and cause false-positive or undetected token regressions.
- **Consequences:** Task 08 expanded to migrate `typography.stories.tsx` and `smoke.stories.tsx` as
  well as `colors.stories.tsx`. Tasks 09 and 10 updated to include `*.stories.tsx` in sweeps and
  the enforcement scanner.
- **Date:** 2026-09-05
- **Affected artifacts:** `areas/storybook-and-documentation.md`, `tasks/08-storybook-and-documentation.md`, `tasks/09-cleanup-and-token-removal.md`, `tasks/10-architecture-enforcement-check.md`.

## D15: Dashboard frontend architecture contract, component taxonomy, and deferred migration

- **Question:** How should the dashboard frontend architecture (`tools/dashboard/ui`) be
  structured, how are component taxonomy and Storybook story titles organized, and how
  should the coexistence of `tools/dashboard/ui/components/ui` and `tools/dashboard/ui/shared/ui`
  be resolved?
- **Options considered:**
  - A — Perform an immediate mass refactor moving all primitives from `components/ui/`
    to `shared/ui/` and updating all import sites across the codebase within the current PR.
  - B — Formally define and document the architecture contract in `docs/development/dashboard-frontend-architecture.md`
    specifying layer responsibilities (`app -> routes -> features -> shared`), component taxonomy
    (primitive, shared composition, feature component, application component), story co-location,
    and testing isolation (`.storybook/test-utils/`). Resolve `shared/ui` as the official target
    for domain-independent primitives, recognize `components/ui` as a legacy exception from initial
    shadcn scaffolding, mandate that any new primitive go into `shared/ui`, and explicitly defer
    mass migration of `components/ui` to a future dedicated change. Align story titles to the
    taxonomy (`Shared/UI/*`, `Features/*`, `Foundations/*`).
- **Decision:** Option B.
- **Rationale:** Mass relocation of `components/ui` touches dozens of files and would create
  extensive git churn and merge conflict hazards on active branches with zero functional or
  semantic benefit. Formally documenting the target architecture and decision matrix establishes
  clear boundaries and prevents further drift without destabilizing the current PR.
- **Consequences:** `docs/development/dashboard-frontend-architecture.md` authored with all 11
  required architectural sections, decision matrix, pseudo-tree, and guidelines. Cross-links
  established in `react-component-guidelines.md`, `storybook.md`, `ui-ux-guidelines.md`, and
  `nevo-ai-ux-guidelines.md`. Story titles aligned to `Shared/UI/*`, `Features/*`, and `Foundations/*`.
  Stale section references to `react-component-guidelines.md` repaired across `tools/dashboard`.
  Mass relocation of `components/ui` to `shared/ui` is deferred to a future change.
- **Date:** 2026-09-05
- **Affected artifacts:** `docs/development/dashboard-frontend-architecture.md`,
  `docs/development/storybook.md`, `docs/development/react-component-guidelines.md`,
  `areas/storybook-and-documentation.md`, `tasks/08-storybook-and-documentation.md`.
