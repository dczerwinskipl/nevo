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
  development:  ['id', 'type', 'title', 'status', 'read_when', 'summary'],
  adr:          ['id', 'type', 'title', 'status', 'date'],
  ai:           ['id', 'type', 'title', 'status', 'read_when', 'summary'],
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

    if (required.includes('read_when') || doc.read_when !== undefined) {
      if (!Array.isArray(doc.read_when) || doc.read_when.length === 0) {
        errors.push(`${loc}: 'read_when' must be a non-empty array of strings`);
      } else {
        for (const item of doc.read_when) {
          if (typeof item !== 'string' || !item.trim()) {
            errors.push(`${loc}: 'read_when' entries must be non-empty strings`);
            break;
          }
        }
      }
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
    mdBody += '| ID | Title | Status | Summary |\n|---|---|---|---|\n';
    for (const doc of typeDocs) {
      const summary = (doc.summary || '').replace(/\r?\n/g, ' ').trim().replace(/\|/g, '\\|');
      const relLink = relative(DOCS_DIR, join(ROOT, doc.file)).replace(/\\/g, '/');
      mdBody += `| \`${doc.id}\` | [${doc.title}](${relLink}) | ${doc.status} | ${summary} |\n`;
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

// ── Path routing and search ────────────────────────────────────────────────

export const ROUTING_INDEX_FILE = join(DOCS_DIR, 'routing.generated.json');

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function globPrefix(pattern) {
  return pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '').replace(/\\/g, '/');
}

export function pathMatchesRule(inputPath, pathGlob) {
  const normInput = normalizePath(inputPath);
  const normGlob = normalizePath(pathGlob);
  if (normInput === normGlob) return true;

  try {
    let reStr = '^';
    let i = 0;
    while (i < normGlob.length) {
      const c = normGlob[i];
      if (c === '*' && normGlob[i + 1] === '*') {
        if (normGlob[i + 2] === '/') {
          reStr += '(?:.*?/)?';
          i += 3;
        } else {
          reStr += '.*';
          i += 2;
        }
      } else if (c === '*') {
        reStr += '[^/]*';
        i++;
      } else if (c === '?') {
        reStr += '[^/]';
        i++;
      } else if (['.', '+', '^', '$', '(', ')', '[', ']', '{', '}', '|', '\\'].includes(c)) {
        reStr += '\\' + c;
        i++;
      } else {
        reStr += c;
        i++;
      }
    }
    reStr += '$';
    if (new RegExp(reStr).test(normInput)) return true;
  } catch {}

  const pInput = normInput.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
  const pGlob = globPrefix(normGlob);
  if (pInput === pGlob || normInput.startsWith(`${pGlob}/`) || pGlob.startsWith(`${pInput}/`)) {
    return true;
  }
  return false;
}

export function loadRoutingRules(indexFile = ROUTING_INDEX_FILE) {
  if (!existsSync(indexFile)) return [];
  try {
    const data = JSON.parse(readUtf8(indexFile));
    return Array.isArray(data?.rules) ? data.rules : [];
  } catch {
    return [];
  }
}

function scoreDoc(doc, normQuery, tokens) {
  const id = (doc.id || '').toLowerCase();
  const title = (doc.title || '').toLowerCase();
  const summary = (doc.summary || '').toLowerCase();
  const readWhen = Array.isArray(doc.read_when) ? doc.read_when.map(r => String(r).toLowerCase()).join(' ') : '';
  const file = (doc.file || '').toLowerCase();
  const related = Array.isArray(doc.related) ? doc.related.map(r => String(r).toLowerCase()).join(' ') : '';

  let score = 0;

  // Exact phrase matches
  if (id === normQuery) score += 200;
  else if (id.includes(normQuery)) score += 100;

  if (title === normQuery) score += 150;
  else if (title.includes(normQuery)) score += 80;

  if (readWhen.includes(normQuery)) score += 60;
  if (summary.includes(normQuery)) score += 40;
  if (file.includes(normQuery)) score += 30;
  if (related.includes(normQuery)) score += 20;

  // Token matches
  let allTokensMatch = tokens.length > 1;
  for (const token of tokens) {
    let tokenMatched = false;
    if (id.includes(token)) { score += 15; tokenMatched = true; }
    if (title.includes(token)) { score += 12; tokenMatched = true; }
    if (readWhen.includes(token)) { score += 10; tokenMatched = true; }
    if (summary.includes(token)) { score += 6; tokenMatched = true; }
    if (file.includes(token)) { score += 4; tokenMatched = true; }
    if (related.includes(token)) { score += 3; tokenMatched = true; }
    if (!tokenMatched) allTokensMatch = false;
  }

  if (allTokensMatch) score += 25;

  return score;
}

// ── Find ───────────────────────────────────────────────────────────────────

export function findDocs(docs, { scope, type, query, path, routingRules } = {}) {
  let results = [...docs];

  if (type) {
    results = results.filter(d => d.type === type);
  }

  if (scope) {
    results = results.filter(d =>
      Array.isArray(d.scope) ? d.scope.includes(scope) : d.scope === scope
    );
  }

  if (path) {
    const rules = routingRules ?? loadRoutingRules();
    const matchedRulesByDoc = new Map();
    for (const rule of rules) {
      if (pathMatchesRule(path, rule.path_glob)) {
        if (!matchedRulesByDoc.has(rule.doc_ref)) {
          matchedRulesByDoc.set(rule.doc_ref, []);
        }
        matchedRulesByDoc.get(rule.doc_ref).push(rule);
      }
    }

    results = results
      .filter(d => matchedRulesByDoc.has(d.file))
      .map(d => {
        const matchingRules = matchedRulesByDoc.get(d.file);
        const ruleId = matchingRules.map(r => r.rule_id).join(', ');
        const matchReason = matchingRules.map(r => `matched routing rule ${r.rule_id} (${r.path_glob})`).join('; ');
        return {
          ...d,
          rule_id: ruleId,
          match_reason: matchReason,
          routing_rules: matchingRules,
        };
      });
  }

  if (query && query.trim()) {
    const normQuery = query.toLowerCase().trim();
    const tokens = normQuery.split(/\s+/).filter(Boolean);
    results = results
      .map(d => ({ doc: d, score: scoreDoc(d, normQuery, tokens) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => (b.score - a.score) || a.doc.id.localeCompare(b.doc.id))
      .map(({ doc, score }) => ({ ...doc, score }));
  } else {
    results.sort((a, b) => a.id.localeCompare(b.id));
  }

  return results;
}
