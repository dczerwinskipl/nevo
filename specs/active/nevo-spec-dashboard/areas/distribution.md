---
id: nevo-spec-dashboard.area.distribution
type: area
change: nevo-spec-dashboard
---

# Area: Distribution seam

## Responsibility

Make the dashboard easy to run during development and produce static assets plus a Node runtime that can later be packaged with the NEvo CLI.

## Requirements

- Keep dashboard dependencies isolated from .NET project dependencies.
- Provide repository-level commands for development, build, test, and production start.
- Allow explicit host and port overrides through command arguments and environment variables while keeping loopback defaults.
- Place generated assets in `tools/dashboard/dist` and exclude them from source control.
- Document the local workflow and the future CLI packaging boundary.
