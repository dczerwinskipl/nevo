## D1: Dashboard application shape

- **Question:** Should the local specification dashboard use a Vite React application with a repository-local Node runtime, a Next.js application, or a development-only prototype?
- **Options considered:** Vite + React tool with Node runtime | Next.js full-stack application | development-only Vite prototype
- **Decision:** Build a Vite + React tool under `tools/dashboard`, backed by a lightweight Node runtime that reuses the existing specification service and produces distributable static assets.
- **Consequences:** The dashboard remains independent of the .NET projects, reads repository files at runtime, can be launched locally from the repository tooling, and can later ship with a combined CLI without introducing a Next.js server runtime.
- **Date:** 2026-08-14
- **Affected artifacts:** `tools/dashboard/**`, root Node scripts and lockfile, dashboard documentation
