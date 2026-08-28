import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one place the dashboard server computes its own position relative to
// the repository root — genuinely shared by every slice that resolves
// repo-relative paths (specs, pull-requests), not owned by any single one.
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
