# Dashboard visual cleanup

## Classification

Class T — Standard. This is a user-visible dashboard styling and responsive-shell change,
but it does not add dependencies, change public APIs, or alter workflow/domain behavior.

## Goal

Make the dashboard read as a restrained, neutral dark developer tool. The neutral
foundation must not derive from the configured interaction accent. Color must carry a
consistent meaning: blue for interaction and current progress, green for healthy or
completed state, amber for review and recoverable warnings, and red for genuine failures.

## Requirements

- Keep the current CSS custom-property and Tailwind utility architecture; evolve the
  existing tokens instead of introducing a second theme layer.
- Use neutral near-black/charcoal values for the page background, surfaces, borders, and
  ordinary text. Changing `--accent` must not recolor those foundation tokens.
- Keep the accent for primary actions, links, selected navigation, focus, active state,
  in-progress state, and progress bars.
- Use success for connected/healthy, clean worktree, approved/verified/completed, and
  done states.
- Use warning for review, unavailable/degraded state, and recoverable tool failures.
- Reserve danger for failed turns, failed operations, destructive affordances, and real
  errors.
- Keep Ready, Draft, New, Idle, ordinary metadata, and synchronized branch badges neutral.
- Keep cards and the sidebar neutral. Selected specification navigation may use a subtle
  accent tint and accent border.
- Remove the full-width desktop application header that repeats the sidebar branding.
  Render only compact connection and refresh controls in the desktop upper-right.
- Preserve the compact branded header and sidebar trigger below the desktop breakpoint.
  Preserve chat navigation and responsive accessibility behavior.

## Scope

- `tools/dashboard/src/index.css`
- `tools/dashboard/src/router.tsx`
- `tools/dashboard/src/components/**`
- `tools/dashboard/tests/**`

## Verification

- `npm --prefix tools/dashboard test`
- `npm --prefix tools/dashboard run build`
- `node tools/specs.mjs check`
- Visual review at desktop, tablet, and mobile widths, including the specification detail
  view and the chat header.
