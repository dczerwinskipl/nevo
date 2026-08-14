---
id: nevo-spec-dashboard.area.dashboard-ui
type: area
change: nevo-spec-dashboard
---

# Area: Dashboard interface

## Responsibility

Provide a focused visual workspace for navigating current and archived specifications and understanding the selected change at a glance.

## Requirements

- Use React, Tailwind, and shadcn-style local components.
- Place the primary specification navigation on the left on desktop and make it accessible on smaller screens.
- Automatically select the sole active specification, while archive entry always starts from its list.
- Show concise overview information, completion progress, a segmented task-stage distribution, task counts, next-ready work, and simplified status lanes.
- Order progress segments as Done, Review, Implementation, Ready, Design, and New.
- Keep Done fully emphasized and render every other progress segment with reduced opacity.
- Stack workflow lanes vertically on phones, wrap them into responsive columns on larger screens, and avoid hidden horizontal scrolling.
- Provide explicit loading, empty, and error states.
- Preserve keyboard, touch, and accessible-label behavior.
