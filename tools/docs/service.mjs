// Domain logic for tools/docs.mjs: scanning, validating, indexing, and finding
// documentation front matter under docs/. No Commander, no process.argv here.

import { existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readUtf8, writeUtf8, walkFiles } from '../lib/fs.mjs';
import { parseFrontMatter } from '../lib/yaml.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DOCS_DIR = join(ROOT, 'docs');
export const INDEX_JSON = join(DOCS_DIR, 'index.generated.json');
export const INDEX_MD = join(DOCS_DIR, 'index.generated.md');

export const REQUIRED_FIELDS = {
  architecture: ['id', 'type', 'title', 'status', 'scope', 'read_when', 'summary'],
  development:  ['id', 'type', 'title', 'status', 'summary'],
  adr:          ['id', 'type', 'title', 'status', 'date'],
  ai:           ['id', 'type', 'title', 'status', 'summary'],
  change:       ['id', 'type', 'title', 'status', 'change'],
  package:      ['id', 'type', 'title', 'status', 'dependencies', 'summary'],
  guide:        ['id', 'type', 'title', 'status', 'summary'],
  project:      ['id', 'type', 'title', 'status', 'summary'],
};

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/docs.mjs generate -->\n\n';
const TIMESTAMP_LINE_RE = /^_Generated: .*_\r?\n\r?\n/m;

// ── Scanning ────────────────────────────────────────────────────────────────

export function scanDocs() {
  const files = walkFiles(DOCS_DIR, { ext: '.md' });
  const docs = [];
  for (const file of files) {
    const content = readUtf8(file);
    const relPath = relative(ROOT, file).replace(/\\/g, '/');
    const fm = parseFrontMatter(content, relPath);
    if (fm === null) continue;
    docs.push({ file: relPath, ...fm });
  }
  return docs;
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateDocs(docs) {
  const errors = [];
  const ids = new Map();

  for (const doc of docs) {
    const loc = doc.file;

    if (!doc.id) { errors.push(`${loc}: missing 'id'`); continue; }
    if (!doc.type) { errors.push(`${loc}: missing 'type'`); continue; }

    if (ids.has(doc.id)) {
      errors.push(`${loc}: duplicate id '${doc.id}' (also in ${ids.get(doc.id)})`);
    } else {
      ids.set(doc.id, loc);
    }

    const required = REQUIRED_FIELDS[doc.type] || ['id', 'type', 'title', 'status'];
    for (const field of required) {
      if (!doc[field]) errors.push(`${loc}: missing required field '${field}' for type '${doc.type}'`);
    }
  }

  for (const doc of docs) {
    const refs = [
      ...(Array.isArray(doc.related) ? doc.related : []),
      ...(doc.supersedes ? [doc.supersedes] : []),
      ...(doc.superseded_by ? [doc.superseded_by] : []),
    ].filter(Boolean);

    for (const ref of refs) {
      if (!ids.has(ref)) {
        errors.push(`${doc.file}: unresolved reference '${ref}'`);
      }
    }
  }

  return errors;
}

// ── Index generation: build (pure, deterministic) + write (I/O) ────────────

function typeOrderIndex(type) {
  const typeOrder = ['architecture', 'development', 'adr', 'ai', 'change'];
  return typeOrder.indexOf(type);
}

/** Build the expected generated index content in memory. Deterministic — no timestamps. */
export function buildDocsIndexes(docs) {
  const sortedDocs = [...docs].sort((a, b) =>
    (typeOrderIndex(a.type) - typeOrderIndex(b.type)) || a.id.localeCompare(b.id)
  );

  const byType = {};
  for (const doc of sortedDocs) {
    (byType[doc.type] = byType[doc.type] || []).push(doc);
  }

  let mdBody = '';
  for (const [type, typeDocs] of Object.entries(byType)) {
    mdBody += `## ${type.charAt(0).toUpperCase() + type.slice(1)}\n\n`;
    mdBody += '| ID | Title | Status | Scopes |\n|---|---|---|---|\n';
    for (const doc of typeDocs) {
      const scopes = Array.isArray(doc.scope) ? doc.scope.join(', ') : (doc.scope || '');
      const relLink = relative(DOCS_DIR, join(ROOT, doc.file)).replace(/\\/g, '/');
      mdBody += `| \`${doc.id}\` | [${doc.title}](${relLink}) | ${doc.status} | ${scopes} |\n`;
    }
    mdBody += '\n';
  }

  return {
    sortedDocs,
    mdHeader: GENERATED_NOTICE + '# Documentation index\n\n',
    mdBody,
  };
}

function renderMd(built, timestamp) {
  return built.mdHeader + `_Generated: ${timestamp}_\n\n` + built.mdBody;
}

/** Persist already-built index content. No decisions made here — just writes. */
export function writeDocsIndexes(built) {
  const timestamp = new Date().toISOString();
  writeUtf8(INDEX_JSON, JSON.stringify({ generated: timestamp, docs: built.sortedDocs }, null, 2));
  writeUtf8(INDEX_MD, renderMd(built, timestamp));
}

/** Compare on-disk generated files against freshly-built expected content, ignoring timestamps. */
export function checkDocsIndexes(docs) {
  const built = buildDocsIndexes(docs);
  const problems = [];

  if (!existsSync(INDEX_JSON)) {
    problems.push('missing: docs/index.generated.json');
  } else {
    const existing = JSON.parse(readUtf8(INDEX_JSON));
    if (JSON.stringify(existing.docs) !== JSON.stringify(built.sortedDocs)) {
      problems.push('stale: docs/index.generated.json');
    }
  }

  if (!existsSync(INDEX_MD)) {
    problems.push('missing: docs/index.generated.md');
  } else {
    const existingBody = readUtf8(INDEX_MD).replace(/\r\n/g, '\n').replace(TIMESTAMP_LINE_RE, '');
    const expectedBody = (built.mdHeader + built.mdBody).replace(/\r\n/g, '\n');
    if (existingBody !== expectedBody) {
      problems.push('stale: docs/index.generated.md');
    }
  }

  return problems;
}

// ── Find ───────────────────────────────────────────────────────────────────

export function findDocs(docs, { scope, type } = {}) {
  let results = docs;
  if (type) results = results.filter(d => d.type === type);
  if (scope) results = results.filter(d =>
    Array.isArray(d.scope) ? d.scope.includes(scope) : d.scope === scope
  );
  return results;
}
