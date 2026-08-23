---
review-of: task
change: chat-ux-improvements-pt1
task: streaming-and-scroll-behavior
generated: 2026-08-23
verdict: pass
---

# Review: chat-ux-improvements-pt1/streaming-and-scroll-behavior

## Verdict

`pass` — no unresolved blocking findings.

## Checklist

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `npm --prefix tools/dashboard test` — passed (includes `scroll-follow.test.mjs`)
- `npm --prefix tools/dashboard run build` — passed

## Scope compliance

Touched paths (`tools/dashboard/src/lib/use-scroll-follow.ts`, `tools/dashboard/src/components/ai-chat.tsx`) are within `allowed_paths`.

## Acceptance-criteria coverage

- [x] AC1: Near-bottom scroll follow hook implemented (`useScrollFollow`).
- [x] AC2: User manual upward scroll disables auto-follow cleanly.
- [x] AC3: Floating "Nowe wiadomości" pill appears when user scrolled up during new content arrival.
- [x] AC4: Clicking pill smoothly scrolls to bottom and re-engages follow.
- [x] AC5: Mobile keyboard opening adjusts scroll when following.
