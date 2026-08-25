import { existsSync } from 'node:fs';

import { readUtf8, writeUtf8 } from '../lib/fs.mjs';
import {
  listChanges,
  ACTIVE_DIR,
  ARCHIVE_DIR,
  ACTIVE_INDEX_MD,
  ARCHIVE_INDEX_MD,
  INDEX_JSON,
} from './store.mjs';

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/specs.mjs generate -->\n\n';

const STATUS_ORDER = [
  'in-implementation', 'approved', 'draft',
  'implemented', 'verified', 'abandoned', 'archived',
];

function toRow(c) {
  return `| \`${c.id}\` | ${c.title} | ${c.status} | ${c.priority ?? '-'} | ${c.created ?? '-'} |\n`;
}

/**
 * Build the expected generated index content in memory. Deterministic — no
 * timestamps in the Markdown. `activeDir`/`archiveDir` default to the real
 * repository's own paths.
 */
export function buildSpecsIndexes({ activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const active = listChanges(activeDir).sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return (a.priority ?? 999) - (b.priority ?? 999);
  });
  const archive = listChanges(archiveDir);

  const header = '| ID | Title | Status | Priority | Created |\n|---|---|---|---|---|\n';

  let activeMd = GENERATED_NOTICE + '# Active specifications\n\n' + header;
  for (const c of active) activeMd += toRow(c);

  let archiveMd = GENERATED_NOTICE + '# Archived specifications\n\n' + header;
  for (const c of archive) archiveMd += toRow(c);

  const changes = [...active, ...archive].map(c => ({
    id: c.id, specId: c.spec_id ?? null, title: c.title, status: c.status, priority: c.priority,
    created: c.created, tasks: c.tasks,
  }));

  return { activeMd, archiveMd, changes, activeCount: active.length, archiveCount: archive.length };
}

export function writeSpecsIndexes(built, { activeIndexMd = ACTIVE_INDEX_MD, archiveIndexMd = ARCHIVE_INDEX_MD, indexJson = INDEX_JSON } = {}) {
  writeUtf8(activeIndexMd, built.activeMd);
  writeUtf8(archiveIndexMd, built.archiveMd);
  let timestamp = new Date().toISOString();
  if (existsSync(indexJson)) {
    try {
      const existing = JSON.parse(readUtf8(indexJson));
      if (JSON.stringify(existing.changes) === JSON.stringify(built.changes)) {
        timestamp = existing.generated || timestamp;
      }
    } catch {}
  }
  writeUtf8(indexJson, JSON.stringify({ generated: timestamp, changes: built.changes }, null, 2));
}

/**
 * Compare on-disk generated files against freshly-built expected content,
 * ignoring the JSON timestamp.
 */
export function checkSpecsIndexes({
  activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR,
  activeIndexMd = ACTIVE_INDEX_MD, archiveIndexMd = ARCHIVE_INDEX_MD, indexJson = INDEX_JSON,
} = {}) {
  const built = buildSpecsIndexes({ activeDir, archiveDir });
  const problems = [];

  if (!existsSync(activeIndexMd)) problems.push('missing: specs/active.generated.md');
  else if (readUtf8(activeIndexMd) !== built.activeMd) problems.push('stale: specs/active.generated.md');

  if (!existsSync(archiveIndexMd)) problems.push('missing: specs/archive.generated.md');
  else if (readUtf8(archiveIndexMd) !== built.archiveMd) problems.push('stale: specs/archive.generated.md');

  if (!existsSync(indexJson)) {
    problems.push('missing: specs/index.generated.json');
  } else {
    const existing = JSON.parse(readUtf8(indexJson));
    if (JSON.stringify(existing.changes) !== JSON.stringify(built.changes)) {
      problems.push('stale: specs/index.generated.json');
    }
  }

  return problems;
}

export function refreshSpecsIndexes({
  activeDir = ACTIVE_DIR,
  archiveDir = ARCHIVE_DIR,
  activeIndexMd = ACTIVE_INDEX_MD,
  archiveIndexMd = ARCHIVE_INDEX_MD,
  indexJson = INDEX_JSON,
} = {}) {
  const built = buildSpecsIndexes({ activeDir, archiveDir });
  writeSpecsIndexes(built, { activeIndexMd, archiveIndexMd, indexJson });
  return built;
}
