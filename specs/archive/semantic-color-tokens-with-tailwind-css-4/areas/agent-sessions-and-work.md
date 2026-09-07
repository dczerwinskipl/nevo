# Area: agent-sessions-and-work

## Responsibility

Migrate the entire `features/agent-sessions/**` feature (creation dialog, list, details,
page, composer, transcript, Work V2 presentation) to the semantic token contract and the
central status/tone module, fix the dangling `--foreground-muted` reference, and rename
`--cat-1`/`--cat-2` consumption to `provider-claude`/`provider-antigravity`.

## Current state

- Highest-density files: `create-agent-session-dialog.tsx` (~50 `-[var(--…)]`
  occurrences, lines 100-269), `agent-session-details.tsx` (~44, lines 42-134),
  `agent-session-list.tsx`, `agent-session-page.tsx`, `composer/agent-session-composer.tsx`,
  `transcript/transcript-message.tsx`, `work-v2/work-indicator-v2.tsx`,
  `work-v2/work-details-sheet-v2.tsx`, `work-v2/work-timeline-v2.tsx`,
  `interactions/interaction-prompt.tsx`, `provider-unavailable-banner.tsx`.
- `--foreground-muted` (undefined, confirmed dangling) used at
  `work-indicator-v2.tsx:90`, `work-details-sheet-v2.tsx:188,254`,
  `work-timeline-v2.tsx:49`, `transcript/transcript-message.tsx:59` — must resolve to
  `text-fg-muted`.
- `agent-session-list.tsx`'s `ProviderBadge` (lines 49-68): `claude` branch uses
  `--cat-1` (line 53), `antigravity` branch uses `--cat-2` (line 60) → rename to
  `provider-claude`/`provider-antigravity`.
- Repeated `color-mix(in_srgb,var(--accent)_8%,transparent)` "selected pill" recipe in
  `create-agent-session-dialog.tsx:153,189` and `interactions/interaction-prompt.tsx:99,139`.
- Repeated `color-mix(in_srgb,var(--warning-strong)_80%|90%,transparent)` muted-warning
  text recipe in `create-agent-session-dialog.tsx:262` and `provider-unavailable-banner.tsx:18`.
- `agent-session-list.tsx:119` — `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`.
- `agent-session-page.tsx:238` — `text-[var(--accent-foreground,white)]`.
- `work-v2/work-indicator-v2.tsx`, `work-v2/pending-interaction-view-v2.tsx`, and
  `features/agent-sessions/turn-work/turn-work-summary.tsx` (**path correction**: this
  file lives under a sibling `turn-work/` directory, not `work-v2/`) have their
  severity/attention-mapping logic migrated by `areas/status-tone-contract.md` (both the
  legacy `transcript/projection.ts` severity and the separate Work-V2-local
  `requiresAttention` projection — these are two different systems, not one shared
  pipeline; see that area's Current state for the full correction). By the time this
  area's task runs, that logic is already migrated — do not re-derive or duplicate it.
  These three files may still have **other, non-severity** `-[var(--…)]` usage (e.g.
  icon colors unrelated to severity/attention state) left for this area's normal sweep
  to catch — inspect each file rather than assuming it's fully done.
- `create-agent-session-dialog.tsx:155-156,190` — `hover:border-white/20` raw white
  usage; other stray white/black occurrences may exist elsewhere in this feature per the
  27-file, 59-occurrence count in `overview.md` — sweep the whole feature directory, not
  just the cited lines.
- **Destructive-action audit (item 5):** `agent-session-details.tsx:120-144` has a real
  irreversible-delete action — "Usuń sesję z dysku" (delete session from disk),
  currently `<Button variant="ghost">` plus ~7 manual `border-[var(--danger-border)]
  bg-[var(--danger-muted)] text-[var(--danger)] hover:bg-[color-mix(...)]
  hover:text-[var(--danger-strong)] focus-visible:ring-[var(--danger)]` overrides. This
  is the confirmed real consumer that justifies `areas/shared-ui-primitives.md` adding a
  `destructive` Button variant — migrate this button to `variant="destructive"`. Per the
  Task 04 implementation finding on nested contrast, the surrounding danger container
  (`agent-session-details.tsx:124`) migrates to a neutral dark surface with a
  destructive border (`border border-action-destructive/30 bg-surface`) rather than
  retaining a red-tinted fill (`bg-[var(--danger-muted)]` / `bg-action-destructive/10`),
  preventing compounded luminance and ensuring the nested destructive button and text
  satisfy ≥4.5:1 contrast.
  Separately, `composer/agent-session-composer.tsx:159-173` has a **different, smaller**
  action — "Przerwij" (stop/cancel the active turn), currently `variant="secondary"`
  plus a light `text-[var(--danger)] hover:bg-[var(--danger-muted)]
  hover:text-[var(--danger-strong)]` override. This is **not** a destructive action in
  D2's sense (interrupting in-progress generation is recoverable, not an irreversible
  delete) — migrate its raw `var()` usages to semantic status tokens (e.g. `text-status-error
  hover:bg-status-error/10 hover:text-status-error`) but keep it visually lighter than
  the delete button and do **not** give it `variant="destructive"`. No other genuine
  destructive action was found elsewhere in this feature, or in `features/specifications/**`/
  `features/pull-requests/**` (checked by grep for delete/remove/destructive button
  patterns — none found there).

## Requirements

- Replace every `-[var(--…)]` occurrence under `features/agent-sessions/**` with the
  matching semantic utility.
- Replace every raw `bg/text/border-white|black` occurrence under
  `features/agent-sessions/**` with a semantic token (+ opacity modifier where the
  original used one).
- Collapse the two duplicated `color-mix(...)` recipes (accent-8%-selected-pill,
  warning-strong-80/90%-muted-text) into direct opacity-modifier utilities
  (`bg-accent/8`, `text-status-warning/80` or `/90` as appropriate) at every call site
  listed above — no component-local `color-mix` may remain.
- `--foreground-muted` call sites become `text-fg-muted`.
- `ProviderBadge` renders Claude with `provider-claude` and Antigravity with
  `provider-antigravity` token-based classes.
- Any status/severity-derived class in this feature (beyond the two files
  `areas/status-tone-contract.md` already migrates) consumes the central status-tone
  module rather than a local mapping — if a new one is discovered during this task,
  route it through the module Area 3 built.

## Constraints

- Depends on `areas/shared-ui-primitives.md` and `areas/status-tone-contract.md` — this
  feature renders through Button/Badge/Dialog/Sheet/StatusCard and the status-tone
  module; do not duplicate their logic locally.
- No visual change except: `provider-claude`/`provider-antigravity` colors stay
  numerically identical to the old `cat-1`/`cat-2` values (rename only, not a repaint),
  and `--foreground-muted` call sites now render a real, defined color instead of a
  dangling/no-op reference (this is a bug fix — that text may become visible for the
  first time where the browser previously silently ignored the invalid `var()`; verify
  the resulting color at each of the 4 sites is appropriate for its context).

## Interfaces and boundaries

- Consumes: `areas/theme-foundation.md` tokens, `areas/shared-ui-primitives.md`
  primitives, `areas/status-tone-contract.md` module.
- Produces: nothing consumed by other areas (agent-sessions is a leaf feature).

## Area-specific acceptance criteria

1. Zero `-[var(--` occurrences remain anywhere under `features/agent-sessions/**`.
2. Zero raw `bg/text/border-white|black` occurrences remain under
   `features/agent-sessions/**`.
3. Zero `color-mix(...)` occurrences remain under `features/agent-sessions/**`.
4. `--foreground-muted` no longer appears anywhere in the codebase.
5. `ProviderBadge` uses `provider-claude`/`provider-antigravity`; `cat-1`/`cat-2` no
   longer appear under `features/agent-sessions/**`.
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
   `npm --prefix tools/dashboard run test:storybook` all pass.
7. Durable Storybook tests for chat/agent-session components pass, covering the two
   explicitly allowed changes under Constraints (D9) as intentional and correct, not a
   claimed pixel-identical baseline.
8. `agent-session-details.tsx`'s delete-session button uses `<Button
   variant="destructive">` with no manual `--danger*` class overrides remaining on it.
   `inspection: source reviewed`
9. `agent-session-composer.tsx`'s "Przerwij" (stop/cancel) button uses semantic status
   tokens (not raw `--danger*` vars) but does **not** use `variant="destructive"` and
   remains visually lighter than the delete button.
   `inspection: source reviewed, visual distinction confirmed`

## Dependencies

`areas/shared-ui-primitives.md`, `areas/status-tone-contract.md`.

## Out of scope

- `work-indicator-v2.tsx`/`pending-interaction-view-v2.tsx`/`turn-work/turn-work-summary.tsx`'s
  severity/attention-mapping logic itself — `areas/status-tone-contract.md`.
- Any `features/specifications/**`, `features/pull-requests/**`,
  `features/operations/**` file — `areas/specs-lanes-and-remaining-ui.md`.
