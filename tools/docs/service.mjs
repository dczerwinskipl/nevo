// Domain logic for tools/docs.mjs: scanning, validating, indexing, and finding
// documentation front matter under docs/. No Commander, no process.argv here.

import { existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readUtf8, writeUtf8, walkFiles, resolveWithinBase } from '../lib/fs.mjs';
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

export function scanDocs({ docsDir = DOCS_DIR, repoRoot = ROOT } = {}) {
  const files = walkFiles(docsDir, { ext: '.md' });
  const docs = [];
  for (const file of files) {
    const content = readUtf8(file);
    const relPath = relative(repoRoot, file).replace(/\\/g, '/');
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

/** Persist already-built index content. Preserves previous timestamp when content is unchanged. */
export function writeDocsIndexes(built, { indexJson = INDEX_JSON, indexMd = INDEX_MD } = {}) {
  let timestamp = new Date().toISOString();
  if (existsSync(indexJson)) {
    try {
      const existing = JSON.parse(readUtf8(indexJson));
      if (JSON.stringify(existing.docs) === JSON.stringify(built.sortedDocs)) {
        timestamp = existing.generated || timestamp;
      }
    } catch {}
  } else if (existsSync(indexMd)) {
    try {
      const match = readUtf8(indexMd).match(/^_Generated:\s*([^\r\n_]+)_/m);
      if (match) timestamp = match[1];
    } catch {}
  }
  writeUtf8(indexJson, JSON.stringify({ generated: timestamp, docs: built.sortedDocs }, null, 2));
  writeUtf8(indexMd, renderMd(built, timestamp));
}

/** Compare on-disk generated files against freshly-built expected content, ignoring timestamps. */
export function checkDocsIndexes(docs, { indexJson = INDEX_JSON, indexMd = INDEX_MD } = {}) {
  const built = buildDocsIndexes(docs);
  const problems = [];

  if (!existsSync(indexJson)) {
    problems.push('missing: docs/index.generated.json');
  } else {
    const existing = JSON.parse(readUtf8(indexJson));
    if (JSON.stringify(existing.docs) !== JSON.stringify(built.sortedDocs)) {
      problems.push('stale: docs/index.generated.json');
    }
  }

  if (!existsSync(indexMd)) {
    problems.push('missing: docs/index.generated.md');
  } else {
    const existingBody = readUtf8(indexMd).replace(/\r\n/g, '\n').replace(TIMESTAMP_LINE_RE, '');
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTerm(term) {
  if (!term || typeof term !== 'string') return '';
  let t = term.toLowerCase().trim();
  t = t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!t) return '';

  if (t === 'statuses' || t === 'status') {
    return 'status';
  }
  if (t.endsWith('ies') && t.length > 4) {
    return t.slice(0, -3) + 'y';
  }
  if (t.endsWith('sses')) {
    return t.slice(0, -2);
  }
  if (t.endsWith('shes') || t.endsWith('ches') || t.endsWith('xes') || t.endsWith('zes')) {
    return t.slice(0, -2);
  }
  if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) {
    return t.slice(0, -1);
  }
  return t;
}

export const TASK_ROUTING_FILE = join(DOCS_DIR, 'ai', 'task-routing.md');
export const CHANGE_IMPACT_MAP_FILE = join(DOCS_DIR, 'ai', 'change-impact-map.md');
const ROUTING_HEADING = '## Routing table';

export function parseRoutingTable(content, source) {
  const rules = [];
  const errors = [];
  const lines = content.split('\n');

  const headingIdx = lines.findIndex(l => l.trim() === ROUTING_HEADING);
  if (headingIdx === -1) {
    errors.push(`${source}: missing '${ROUTING_HEADING}' section`);
    return { rules, errors };
  }

  let i = headingIdx + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (lines[i].trim().startsWith('#')) {
      errors.push(`${source}: '${ROUTING_HEADING}' section has no table before the next heading`);
      return { rules, errors };
    }
    i++;
  }
  if (i >= lines.length) {
    errors.push(`${source}: '${ROUTING_HEADING}' section has no table`);
    return { rules, errors };
  }

  const header = lines[i].split('|').slice(1, -1).map(c => c.trim().toLowerCase());
  if (header.length !== 3 || header[0] !== 'rule_id' || header[1] !== 'path_glob' || header[2] !== 'doc_ref') {
    errors.push(`${source}: routing table header must be exactly 'rule_id | path_glob | doc_ref' (got '${lines[i].trim()}')`);
    return { rules, errors };
  }

  const separatorLine = lines[i + 1];
  const separatorCells = (separatorLine || '').split('|').slice(1, -1).map(c => c.trim());
  const isValidSeparator = separatorCells.length === 3 && separatorCells.every(c => /^:?-+:?$/.test(c));
  if (!isValidSeparator) {
    errors.push(
      `${source}: routing table header must be followed by a valid separator row ` +
      `(e.g. '|---|---|---|'), got '${(separatorLine || '').trim()}'`
    );
    return { rules, errors };
  }
  i += 2;

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim().startsWith('|')) break;
    const cells = raw.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 3 || cells.some(c => !c)) {
      errors.push(`${source}: malformed routing table row: '${raw.trim()}'`);
      continue;
    }
    const [rule_id, path_glob, doc_ref] = cells;
    rules.push({ rule_id, path_glob, doc_ref, source });
  }

  return { rules, errors };
}

export function validateRoutingTables(sources, repoRoot = ROOT) {
  const errors = [];
  const allRules = [];
  for (const { file, content } of sources) {
    const { rules, errors: parseErrors } = parseRoutingTable(content, file);
    errors.push(...parseErrors);
    allRules.push(...rules);
  }

  const seen = new Map();
  for (const rule of allRules) {
    if (seen.has(rule.rule_id)) {
      errors.push(`${rule.source}: duplicate rule_id '${rule.rule_id}' (also in ${seen.get(rule.rule_id)})`);
    } else {
      seen.set(rule.rule_id, rule.source);
    }
    let resolvedDocRef;
    try {
      resolvedDocRef = resolveWithinBase(repoRoot, rule.doc_ref);
    } catch {
      errors.push(`${rule.source}: routing rule '${rule.rule_id}' has a doc_ref '${rule.doc_ref}' that escapes the repository`);
      continue;
    }
    if (!existsSync(resolvedDocRef)) {
      errors.push(`${rule.source}: routing rule '${rule.rule_id}' references missing doc_ref '${rule.doc_ref}'`);
    }
  }

  return { rules: allRules, errors };
}

export function readRoutingSources(repoRoot = ROOT) {
  const taskRouting = join(repoRoot, 'docs', 'ai', 'task-routing.md');
  const changeImpact = join(repoRoot, 'docs', 'ai', 'change-impact-map.md');
  return [taskRouting, changeImpact].map(f => ({
    file: relative(repoRoot, f).replace(/\\/g, '/'),
    content: existsSync(f) ? readUtf8(f) : '',
  }));
}

export function buildRoutingIndex(rules) {
  const sorted = rules
    .map(({ rule_id, path_glob, doc_ref, source }) => ({ rule_id, path_glob, doc_ref, source }))
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  return { rules: sorted };
}

export function writeRoutingIndex(built, indexFile = ROUTING_INDEX_FILE) {
  let timestamp = new Date().toISOString();
  if (existsSync(indexFile)) {
    try {
      const existing = JSON.parse(readUtf8(indexFile));
      if (JSON.stringify(existing.rules) === JSON.stringify(built.rules)) {
        timestamp = existing.generated || timestamp;
      }
    } catch {}
  }
  writeUtf8(indexFile, JSON.stringify({ generated: timestamp, ...built }, null, 2));
}

export function checkRoutingIndex(built, indexFile = ROUTING_INDEX_FILE) {
  if (!existsSync(indexFile)) return ['missing: docs/routing.generated.json'];
  const existing = JSON.parse(readUtf8(indexFile));
  if (JSON.stringify(existing.rules) !== JSON.stringify(built.rules)) {
    return ['stale: docs/routing.generated.json'];
  }
  return [];
}

export function loadRoutingRules(indexFile = ROUTING_INDEX_FILE) {
  if (!existsSync(indexFile)) {
    throw new Error(`Missing routing index '${indexFile}'. Run: node tools/docs.mjs generate`);
  }
  let data;
  try {
    data = JSON.parse(readUtf8(indexFile));
  } catch (err) {
    throw new Error(`Malformed routing index '${indexFile}': ${err.message}. Run: node tools/docs.mjs generate`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.rules)) {
    throw new Error(`Invalid routing index '${indexFile}': missing 'rules' array. Run: node tools/docs.mjs generate`);
  }
  return data.rules;
}

function scoreDoc(doc, rawQueryNorm, uniqueTokens) {
  const idLower = (doc.id || '').toLowerCase();
  const titleLower = (doc.title || '').toLowerCase();
  const summaryLower = (doc.summary || '').toLowerCase();
  const readWhenStr = Array.isArray(doc.read_when) ? doc.read_when.map(r => String(r).toLowerCase()).join(' ') : '';
  const fileLower = (doc.file || '').toLowerCase();
  const relatedStr = Array.isArray(doc.related) ? doc.related.map(r => String(r).toLowerCase()).join(' ') : '';

  let phraseScore = 0;
  const matchedFieldsSet = new Set();

  // 1. Exact full ID or exact Title match (strongest signals)
  if (idLower === rawQueryNorm) {
    phraseScore += 100000;
    matchedFieldsSet.add('id');
  }
  if (titleLower === rawQueryNorm) {
    phraseScore += 80000;
    matchedFieldsSet.add('title');
  }

  // Exact normalized multi-word phrase match
  if (uniqueTokens.length > 1) {
    const normPhrase = uniqueTokens.join(' ');
    const phraseRe = new RegExp(`(?:^|\\s)${escapeRegExp(normPhrase)}(?:$|\\s)`);

    const phraseCandidates = [
      { name: 'id', text: idLower, weight: 50000 },
      { name: 'title', text: titleLower, weight: 40000 },
      { name: 'read_when', text: readWhenStr, weight: 20000 },
      { name: 'summary', text: summaryLower, weight: 10000 },
      { name: 'file', text: fileLower, weight: 5000 },
      { name: 'related', text: relatedStr, weight: 2000 },
    ];

    for (const cand of phraseCandidates) {
      const fieldWords = cand.text.split(/[^a-z0-9]+/).filter(Boolean).map(normalizeTerm).join(' ');
      if (phraseRe.test(fieldWords)) {
        phraseScore += cand.weight;
        matchedFieldsSet.add(cand.name);
      }
    }
  }

  // Field relevance hierarchy for complete word matches
  const fieldData = [
    { name: 'id', text: idLower, weight: 50 },
    { name: 'title', text: titleLower, weight: 40 },
    { name: 'read_when', text: readWhenStr, weight: 30 },
    { name: 'summary', text: summaryLower, weight: 20 },
    { name: 'file', text: fileLower, weight: 10 },
    { name: 'related', text: relatedStr, weight: 5 },
  ];

  const matchedTermsSet = new Set();
  let fieldRelevanceScore = 0;

  for (const field of fieldData) {
    const words = field.text.split(/[^a-z0-9]+/).filter(Boolean);
    const normalizedWords = words.map(normalizeTerm);
    const wordSet = new Set(normalizedWords);

    let fieldMatchedAny = false;
    for (const token of uniqueTokens) {
      // Conservative word matching: count distinct-term coverage only for complete normalized words.
      // Arbitrary substrings such as "app" inside "approval" must NOT match.
      if (wordSet.has(token)) {
        matchedTermsSet.add(token);
        fieldMatchedAny = true;
        fieldRelevanceScore += field.weight;
      }
    }

    if (fieldMatchedAny) {
      matchedFieldsSet.add(field.name);
    }
  }

  // If no complete query terms matched and no exact/phrase match, do not match
  if (matchedTermsSet.size === 0 && phraseScore === 0) {
    return {
      score: 0,
      matched_terms: [],
      matched_fields: [],
      term_coverage: 0,
    };
  }

  // Partial ID or path discovery as a separate lower-priority signal
  // Does not grant term coverage or add to matchedTermsSet
  let partialDiscoveryScore = 0;
  if (rawQueryNorm.length >= 3) {
    if (idLower.includes(rawQueryNorm)) partialDiscoveryScore += 20;
    if (fileLower.includes(rawQueryNorm)) partialDiscoveryScore += 10;
  }

  const termCoverage = uniqueTokens.length > 0 ? (matchedTermsSet.size / uniqueTokens.length) : 0;
  // 2. Distinct normalized query term coverage
  const distinctTermScore = matchedTermsSet.size * 1000;
  const allTermsBonus = (uniqueTokens.length > 1 && matchedTermsSet.size === uniqueTokens.length) ? 500 : 0;

  const totalScore = phraseScore + distinctTermScore + allTermsBonus + fieldRelevanceScore + partialDiscoveryScore;

  return {
    score: totalScore,
    matched_terms: uniqueTokens.filter(t => matchedTermsSet.has(t)),
    matched_fields: Array.from(matchedFieldsSet),
    term_coverage: termCoverage,
  };
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
    const rawQueryNorm = query.toLowerCase().trim();
    const rawTokens = rawQueryNorm.split(/[^a-z0-9]+/).filter(Boolean);
    const uniqueTokens = [...new Set(rawTokens.map(normalizeTerm).filter(Boolean))];

    results = results
      .map(d => {
        const evidence = scoreDoc(d, rawQueryNorm, uniqueTokens);
        return { doc: d, ...evidence };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => (b.score - a.score) || a.doc.id.localeCompare(b.doc.id))
      .map(({ doc, score, matched_terms, matched_fields, term_coverage }) => ({
        ...doc,
        score,
        matched_terms,
        matched_fields,
        term_coverage,
      }));
  } else {
    results.sort((a, b) => a.id.localeCompare(b.id));
  }

  return results;
}
