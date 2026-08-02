---
id: guides.installation
type: guide
title: Installation
status: current
summary: >
  How to reference NEvo packages in a new project today, and the open question around
  NuGet publishing this guide does not paper over.
---

# Installation

This guide is for **consumers** — adding NEvo to a new project of your own. If you're
setting up this repository itself to build, test, or contribute to NEvo, see
[Local setup](../development/local-setup.md) instead; that page covers prerequisites,
build/test commands, and running the example applications, which this guide does not
repeat.

## Prerequisites

Cross-link, not duplicated: [Local setup](../development/local-setup.md) § Prerequisites
covers the .NET SDK version (pinned in `global.json`) you need installed.

## No NuGet feed exists yet

**Open question, not resolved by this guide:** this repository has no NuGet publishing
configured. Checked directly:

- No `.nuspec` file and no `NuGet.config` anywhere in the repository.
- `Directory.Build.props` sets no packaging properties (`IsPackable`, `PackageId`,
  `Version`, etc.) for any project.
- `.github/workflows/dotnet.yml` — the only CI workflow — restores, builds, and tests;
  it has no `dotnet pack` or publish step.

There is currently no `dotnet add package NEvo.Core` (or similar) that pulls from a
real, published feed. Do not treat any such command as available until this is
resolved.

## What works today: project reference

The only verified path, confirmed by how this repository builds itself: clone the
repository and reference the specific package project(s) you need directly.

```bash
git clone <this-repository-url>
```

```xml
<ItemGroup>
  <ProjectReference Include="..\nevo\src\NEvo.Core\NEvo.Core.csproj" />
  <ProjectReference Include="..\nevo\src\NEvo.Messaging\NEvo.Messaging.csproj" />
</ItemGroup>
```

Adjust the relative path to wherever you cloned the repository. See
[Package classification](../packages/classification.md) for which package provides
what, and each package's own doc (linked from there) for its exact dependencies —
reference only what you need; e.g. a minimal service needs just `NEvo.Core`, add
`NEvo.Messaging` when you need message dispatch.

## Verification

```bash
dotnet build
```

A successful build confirms the reference resolves and the referenced package's public
API is available to your project.

## Next steps

Continue to the [Quick start](quick-start.md) guide for a minimal working setup using
`NEvo.Core` and `NEvo.Messaging`.
