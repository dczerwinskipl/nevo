---
id: nevo-spec-dashboard.area.data-runtime
type: area
change: nevo-spec-dashboard
---

# Area: Data runtime

## Responsibility

Project canonical active/archive manifests and overview Markdown into a stable, read-only dashboard API and notify connected clients when relevant source files change.

## Requirements

- Reuse `tools/specs/service.mjs` rather than maintaining a second YAML schema parser.
- Derive summaries and metrics defensively when optional Markdown content is absent.
- Derive per-stage actionable task counts and calculate completion progress only from tasks mapped to Done.
- Expose only repository-relative paths to the browser.
- Watch `change.yaml` and relevant Markdown files under `specs/active` and `specs/archive`.
- Keep lifecycle status values canonical in API data; simplified lanes are a presentation projection.
- Treat membership in `specs/archive` as the authoritative archived change status, including for legacy manifests.
- Persist `status: archived` when the framework moves a change into the archive.
