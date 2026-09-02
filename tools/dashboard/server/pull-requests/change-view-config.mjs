import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A reasonable out-of-the-box default — this repo's own actual top-level
// structure, not a universal assumption about every consumer repo's layout
// (area changes-grouping-and-filtering: "do not hardcode NEvo's own
// directory structure as a universal default beyond a reasonable
// out-of-the-box config that this repo itself uses").
export const DEFAULT_CHANGE_VIEW = Object.freeze({
  groups: [
    { name: 'Specs', paths: ['specs/**'] },
    { name: 'Source', paths: ['src/**'] },
    { name: 'Tests', paths: ['tests/**'] },
    { name: 'Tooling: AI', paths: ['tools/dashboard/server/ai/**', '.claude/**', '.cursor/**'] },
    { name: 'Tooling: Dashboard Server', paths: ['tools/dashboard/server/**'] },
    { name: 'Tooling: Dashboard UI', paths: ['tools/dashboard/ui/**', 'tools/dashboard/vite.config.ts'] },
    { name: 'Tooling: Dashboard Storybook', paths: ['tools/dashboard/.storybook/**', '.storybook/**', '**/.storybook/**'] },
    { name: 'Tooling: Dashboard', paths: ['tools/dashboard/**'] },
    { name: 'Tooling: Specs', paths: ['tools/specs/**', 'tools/specs.mjs'] },
    { name: 'Tooling: Docs', paths: ['tools/docs/**', 'tools/docs.mjs'] },
    { name: 'Tooling: Tests', paths: ['tools/tests/**'] },
    { name: 'Tooling: Other', paths: ['tools/**'] },
    { name: 'Docs', paths: ['docs/**'] },
    { name: 'Other', paths: ['**/*'], fallback: true },
  ],
});

export const DEFAULT_GENERATED_FILES = Object.freeze({
  rules: [
    { paths: ['**/*.generated.*', '**/dist/**', '**/*.min.js', '**/*.min.css'] },
  ],
  lockfiles: ['**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock'],
});

// Per-project config (area requirement: "must work for a consumer repo other
// than NEvo, not just this one") — first candidate found under the repo root
// wins; a missing or malformed file falls back to this repo's own defaults
// above rather than failing the request.
const CONFIG_PATH_CANDIDATES = ['.nevo/dashboard-view.json', 'dashboard-view.config.json'];

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function loadChangeViewConfig({ repoRoot }) {
  for (const candidate of CONFIG_PATH_CANDIDATES) {
    const parsed = readJsonIfExists(join(repoRoot, candidate));
    if (parsed) {
      return {
        changeView: parsed.changeView || DEFAULT_CHANGE_VIEW,
        generatedFiles: parsed.generatedFiles || DEFAULT_GENERATED_FILES,
      };
    }
  }
  return { changeView: DEFAULT_CHANGE_VIEW, generatedFiles: DEFAULT_GENERATED_FILES };
}
