# Area: react-class-composition-guidelines

## Responsibility

Extend `docs/development/react-component-guidelines.md` with durable rules for Tailwind
class composition (local layout vs. reusable `cva()` variants vs. domain-state-to-tone
projection vs. native DOM/ARIA state variants vs. `cn()` usage vs. banned interpolated
class construction vs. multi-slot recipes vs. `@apply` scope), update that document's
review checklist, and update `docs/ai/task-routing.md` so future `tools/dashboard/ui/**`
work is routed through these rules — before any component migration in this change
begins.

## Current state

- `docs/development/react-component-guidelines.md` (`status: current`) already defines
  component/module architecture (composition, feature-local ownership, file-size
  inspection triggers, layering, visual-vs-orchestration split, hooks, view models,
  state/effects, accessibility, testing) and a review checklist (§11,
  `react-component-guidelines.md:381-396`) — it does **not** yet contain any rule about
  *how* Tailwind classes themselves should be composed (no `cva()` guidance, no
  domain-state-to-tone flow, no interpolated-class ban).
- `docs/ai/task-routing.md`'s "Developing React UI and Dashboard frontend" section
  (`task-routing.md:110-117`) already routes all `tools/dashboard/ui/**` work
  (`RT-16`, `task-routing.md:146`) to `react-component-guidelines.md` and lists
  "Semantic Tailwind tokens and accessible Radix UI primitives are used for UI
  consistency" as an invariant (`task-routing.md:116`) — this invariant needs to name the
  new class-composition contract explicitly once it exists, since the routing table
  itself (`RT-16`) already points at the right document and needs no new row.
- Existing stack confirmed by inspection (no new dependency needed): `cn()` at
  `tools/dashboard/ui/lib/utils.ts:4` (`clsx` + `tailwind-merge`, exact composition
  confirmed); `class-variance-authority` (`^0.7.1`), `clsx` (`^2.1.1`),
  `tailwind-merge` (`^3.6.0`) are all direct `dependencies`
  (`tools/dashboard/package.json:32-33,42`); exactly two existing `cva()` recipes —
  `button.tsx:7` (`variant`, `size`) and `sheet.tsx:29` (`side`) — both already derive
  props via `VariantProps`.
- Three independent status/tone-mapping helpers already exist, confirmed by inspection —
  evidence this repo already needs the "keep close to the feature, promote only when
  genuinely shared" rule stated explicitly:
  - `tools/dashboard/ui/shared/ui/status-label.tsx:19-40`'s `statusTone()`
    (consumed by `specification-detail.tsx:146` and `agent-session-list.tsx:139`);
  - `tools/dashboard/ui/features/agent-sessions/transcript/projection.ts:34,43-54`'s
    `PresentationSeverity` type and `computePresentationSeverity()` (the real source
    consumed by `work-indicator-v2.tsx`/`turn-work-summary.tsx`'s severity mapping — not
    those two files themselves, correcting the assumption in
    `areas/status-tone-contract.md`'s original discovery note);
  - `tools/dashboard/ui/features/pull-requests/changes/status.ts:10-15`'s `stateTone()`
    (a third, newly-discovered, independent PR-state → full-Tailwind-class-string
    mapping, feature-local to `pull-requests`, not previously identified by this
    change's discovery).
- `StatusCard` (`components/ui/status-card.tsx:52-53`) has a real variant API
  (`variant: 'error'|'warning'|'info'`, `size: 'sm'|'default'`) implemented by hand via
  `cn()` + boolean ternaries (`status-card.tsx:88-104`), **not** `cva()` — a concrete,
  in-repo example of exactly the "reusable component with a stable visual API" case the
  new rule says should use `cva()`.
- No occurrence of the literally-banned interpolated-class pattern
  (`` `text-status-${x}` ``) exists anywhere in the codebase today (confirmed by
  repo-wide search) — the rule is preventive, not a fix for an existing violation. A
  related-but-distinct pattern (ternary expressions selecting whole pre-written class
  strings instead of using `cn()`) exists at 5 call sites already targeted by
  `tasks/06-*`/`tasks/07-*` for their `color-mix` cleanup — worth converting to `cn()`
  composition in the same edit, not a separate concern.
- No ESLint/Biome config exists anywhere in the repo (confirmed) — this area's rules are
  documented guidance and a required-inspection checklist, not automated lint rules; no
  new dependency is introduced here.

## Requirements

- Add a new section to `react-component-guidelines.md` (e.g. "§12 Tailwind class
  composition") covering, using the change request's own text as the normative content:
  - **Local static layout** — one-off structural classes stay inline in JSX; a long but
    static, cohesive class list is not automatically an extraction problem; never
    extract a class string into a constant solely to shorten JSX.
  - **Reusable component variants** — use `cva()` when a component has a stable visual
    API (`variant`/`tone`/`size`/`emphasis`/`density`); keep the recipe beside the
    component; derive props via `VariantProps`; use `compoundVariants` only for genuine
    cross-axis interactions, and treat a large compound matrix as a signal to inspect
    whether the component mixes responsibilities or domain state has leaked into its
    visual API.
  - **Domain state and presentation tone** — domain state must not directly select
    Tailwind classes in JSX; the required flow is canonical domain state → semantic
    presentation tone → component variant → Tailwind utility → theme token; define the
    `StatusTone` union type exactly as given:
    ```ts
    type StatusTone =
      | 'neutral'
      | 'active'
      | 'success'
      | 'warning'
      | 'error'
      | 'attention'
      | 'info';
    ```
    a visual component receives `tone`, never the raw provider status or booleans like
    `isError`/`isWarning`/`requiresAttention`; keep canonical-status-to-tone mappings
    feature-local, promote to shared code only when multiple independent features
    genuinely share the same canonical contract (cite the three existing feature-local
    mapping helpers above as the concrete example this rule generalizes from).
  - **DOM and interaction state** — use native Tailwind variants (`hover:`,
    `focus-visible:`, `disabled:`, `aria-selected:`, `data-[state=open]:`, `group-*`,
    `peer-*`) for state already owned by the element/behavior primitive; do not
    introduce a React boolean solely to reproduce state already exposed via HTML/ARIA/
    Radix data attributes.
  - **Conditional composition** — `cn(componentVariants({ tone, size }), className)` is
    the pattern for conditional inclusion and consumer overrides; `cn()` is not a
    substitute for a variant model or domain-state projection; do not accumulate large
    collections of unrelated boolean class expressions inside `cn()`.
  - **Tailwind source detection** — every possible class must exist as a complete static
    string; ban interpolated construction (`` `text-status-${tone}` ``); use a typed
    static map or `cva()` instead.
  - **Multi-slot components** — for root/icon/title/description-style components, keep a
    small typed slot recipe local to the component, one focused recipe per slot where
    readable, avoid duplicating domain-status decisions per slot, and don't introduce a
    new variants library unless repeated multi-slot complexity across several
    independent primitives demonstrates real need.
  - **CSS and `@apply`** — reserve custom CSS/`@apply` for genuinely selector-oriented or
    non-React-boundary cases (Markdown content, third-party markup, global
    pseudo-elements, global document styling, browser-specific behavior); never move
    ordinary component variants into global CSS merely to shorten class names.
  - **Required inspection when touching a component** — reproduce the 7-item checklist
    from the change request verbatim (existing-primitive check, existing-variant check,
    local-layout-vs-recipe-vs-domain-mapping classification, visual-vs-orchestration
    check, hidden-boolean-variant check, existing-Storybook-coverage check,
    additional-story/behavior-test-need check) as its own subsection, and fold it into
    §11's review checklist as additional checkbox items (do not create two competing
    checklists — one is the narrative rule, the other is the checkbox list; keep them
    consistent).
- Update `task-routing.md`'s "Developing React UI and Dashboard frontend" § "Invariants
  to preserve" (`task-routing.md:113-116`) to name the new class-composition contract
  explicitly (e.g. "Tailwind classes follow the documented composition contract:
  `cva()` for reusable variant APIs, domain-state → tone → variant → utility → token for
  status/severity presentation, no interpolated class construction") — `RT-16` in the
  routing table already covers `tools/dashboard/ui/**`, so no new table row is needed,
  only the prose invariant.
- Do not modify `docs/development/ui-ux-guidelines.md`, `docs/development/nevo-ai-ux-guidelines.md`,
  or `docs/development/nevo-interaction-model.md` — their `StatusTone`-adjacent content
  (the provisional semantic state token table in `ui-ux-guidelines.md` §4.2, the status
  semantics in `nevo-ai-ux-guidelines.md` §3) already describes the same 7(+1)-state
  contract at the product/UX level; this area's change is About React
  implementation-level class composition specifically, and none of those three
  documents' durable contracts change as a result of this area (per the change request's
  own instruction: "modify only documents whose durable contract actually changes").

## Constraints

- This is a documentation-only area — no `tools/dashboard/ui/**` source file changes.
- Must complete (or at minimum, its content must be finalized and available as task
  context) before any task that touches `components/ui/**` or feature presentation code
  begins, since those tasks must follow the new rules from the start, not be retrofitted
  afterward.

## Interfaces and boundaries

- Produces: the durable class-composition rules every subsequent component-touching
  task in this change must follow (`tasks/04`, `05`, `06`, `07`) and the updated review
  checklist those tasks' own "required inspection" acceptance criteria point back to.
- Consumes: nothing from other areas.

## Area-specific acceptance criteria

1. `react-component-guidelines.md` contains the new class-composition section with all
   8 subsections listed above, including the exact `StatusTone` type.
2. §11's review checklist includes the "required inspection" items, without duplicating
   or contradicting the narrative subsection.
3. `task-routing.md`'s "Developing React UI and Dashboard frontend" invariants name the
   new contract explicitly; the `RT-16` routing-table row is unchanged (still correct).
4. `node tools/docs.mjs validate` and `node tools/docs.mjs check` pass.
5. No other `docs/development/*.md` file is modified by this area.

## Dependencies

None. Independent of `areas/frontend-formatter-baseline.md` — both are prerequisite
areas and may proceed in parallel.

## Out of scope

- Any actual component migration/refactor — that's `tasks/04`, `05`, `06`, `07`, which
  apply these rules while doing their own already-scoped work.
- `ui-ux-guidelines.md`, `nevo-ai-ux-guidelines.md`, `nevo-interaction-model.md`.
