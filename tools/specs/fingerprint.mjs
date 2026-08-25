import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { readUtf8, resolveWithinBase } from '../lib/fs.mjs';
import { parseFrontMatterFile } from '../lib/yaml.mjs';

// ── Three-tier canonical semantic fingerprint (D7, D18, D27, D28) ──────────
//
// Each function extracts specific semantic fields from parsed structures and
// hashes that projection — never raw file bytes — so status, execution.suspension,
// and self_check are simply never read here, not excluded after the fact.

// Fields whose membership, not order, is the semantic fact — YAML authors
// reordering one of these must never change the fingerprint. Object-valued
// entries (e.g. context_exceptions' {omitted, decision, reason} tuples) sort
// by their own canonical JSON form, which is itself key-order-independent
// (stableStringify is applied recursively before the sort).
export const SET_LIKE_KEYS = new Set([
  'allowed_paths', 'consequential_paths', 'forbidden_paths', 'required', 'optional',
  'decisions', 'constraints', 'dependency_contracts', 'context_exceptions',
]);

/**
 * Deterministic, key-order-independent serialization: object keys are
 * sorted recursively, and any array reached via a `SET_LIKE_KEYS` key is
 * sorted too (by each element's own canonical form) — so semantically
 * equivalent YAML (reordered mapping keys, reordered set-like lists)
 * produces byte-identical output before hashing. `keyHint` is the property
 * name the caller is about to serialize `value` under, if any.
 */
export function stableStringify(value, keyHint) {
  if (Array.isArray(value)) {
    const items = value.map(v => stableStringify(v));
    if (SET_LIKE_KEYS.has(keyHint)) items.sort();
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k], k)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashProjection(parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? part : stableStringify(part));
    hash.update('\n\x00\n');
  }
  return hash.digest('hex');
}

export function readIfExists(path) {
  return existsSync(path) ? readUtf8(path) : '';
}

const DECISION_HEADER_RE = /^## (D\d+):.*$/gm;
const SUPERSESSION_MARKER_RE = /(D\d+)\s+is\s+authoritative\b/;

/**
 * Parse `owner-decisions.md` into `{ id -> { text, supersededBy } }`.
 * `supersededBy` is set only when a decision's own text explicitly marks
 * itself superseded (e.g. D1's "kept for the audit trail; D7 is
 * authoritative on granularity") — a "Refined by" note that merely narrows
 * or extends an earlier decision does not count (see `overview.md` §
 * "Owner-decision supersession").
 */
export function parseOwnerDecisions(content) {
  const headers = [...content.matchAll(DECISION_HEADER_RE)];
  const map = new Map();
  for (let i = 0; i < headers.length; i++) {
    const id = headers[i][1];
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : content.length;
    const text = content.slice(start, end);
    const marker = text.match(SUPERSESSION_MARKER_RE);
    map.set(id, { text, supersededBy: marker && marker[1] !== id ? marker[1] : null });
  }
  return map;
}

/** Follow a decision's `supersededBy` chain to the currently-active entry's own text. */
export function resolveActiveDecisionText(decisionsMap, id, seen = new Set()) {
  const entry = decisionsMap.get(id);
  if (!entry) return null;
  if (entry.supersededBy && !seen.has(id)) {
    seen.add(id);
    return resolveActiveDecisionText(decisionsMap, entry.supersededBy, seen);
  }
  return entry.text;
}

const CONSTRAINT_BULLET_RE = /^- \*\*(C\d+)\.\*\*\s?(.*)$/gm;

/** Parse `overview.md`'s numbered `- **Cn.** ...` constraint bullets into `{ id -> text }`. */
export function parseConstraints(overviewContent) {
  const map = new Map();
  for (const m of overviewContent.matchAll(CONSTRAINT_BULLET_RE)) map.set(m[1], m[2]);
  return map;
}

/**
 * `computeChangeFingerprint(change)` — a canonical projection over change
 * scope, shared constraints, and change-level acceptance criteria (all live
 * in `overview.md`'s own prose) plus the task graph's shape (ids +
 * `depends_on` edges only, never per-task status).
 */
export function computeChangeFingerprint(change) {
  const overview = readIfExists(join(change._dir, 'overview.md'));
  const taskGraph = change.tasks
    .map(t => ({ id: t.id, depends_on: [...(t.depends_on || [])].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return hashProjection(['change-fingerprint-v1', overview, taskGraph]);
}

export function loadTaskFileParts(change, task) {
  const filePath = resolveWithinBase(change._dir, task.file);
  const raw = readUtf8(filePath);
  const fm = parseFrontMatterFile(filePath);
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return { fm, body };
}

/** Parse a task's "## Verification" fenced code block into one command string per line. */
export function parseVerificationCommands(body) {
  const match = body.match(/##\s*Verification\s*\r?\n+```[a-zA-Z]*\r?\n([\s\S]*?)```/i);
  if (!match) return [];
  return match[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/**
 * `computeTaskFingerprint(change, taskId)` — a canonical projection over that
 * task's own definition (its file's body — goal, constraints, acceptance
 * criteria, out-of-scope — excluding its front matter's `status`, which is
 * simply never read), `allowed_paths`/`consequential_paths`/`forbidden_paths`,
 * `context`, `context_exceptions`, this task's own `depends_on` edges, and
 * `semantic_references` (D18).
 */
export function computeTaskFingerprint(change, taskId, seen = new Set()) {
  const task = change.tasks.find(t => t.id === taskId);
  if (!task || !task.file) return hashProjection(['task-fingerprint-v1', taskId, 'missing']);

  const { fm, body } = loadTaskFileParts(change, task);
  const sr = fm.semantic_references || {};

  const ownProjection = {
    id: task.id,
    depends_on: [...(task.depends_on || [])].sort(),
    context: fm.context || {},
    allowed_paths: [...(fm.allowed_paths || [])].sort(),
    consequential_paths: [...(fm.consequential_paths || [])].sort(),
    forbidden_paths: [...(fm.forbidden_paths || [])].sort(),
    context_exceptions: fm.context_exceptions || [],
  };

  const decisionsMap = parseOwnerDecisions(readIfExists(join(change._dir, 'owner-decisions.md')));
  const constraintsMap = parseConstraints(readIfExists(join(change._dir, 'overview.md')));

  const decisionTexts = [...(sr.decisions || [])].sort()
    .map(id => resolveActiveDecisionText(decisionsMap, id) ?? `unresolved:${id}`);
  const constraintTexts = [...(sr.constraints || [])].sort()
    .map(id => constraintsMap.get(id) ?? `unresolved:${id}`);

  const nextSeen = new Set(seen).add(taskId);
  const dependencyFingerprints = [...(sr.dependency_contracts || [])].sort()
    .map(depId => (nextSeen.has(depId) ? `cycle:${depId}` : computeTaskFingerprint(change, depId, nextSeen)));

  return hashProjection([
    'task-fingerprint-v1', ownProjection, body, decisionTexts, constraintTexts, dependencyFingerprints,
  ]);
}

/**
 * `computeImplementationFingerprint(change, taskId, evidence)` — the task-level
 * fingerprint plus a reviewed diff/revision identifier and evidence references.
 */
export function computeImplementationFingerprint(change, taskId, { revision = null, evidence = [] } = {}) {
  const taskFingerprint = computeTaskFingerprint(change, taskId);
  return hashProjection(['implementation-fingerprint-v1', taskFingerprint, revision, evidence]);
}

/**
 * `computeImplementationFingerprint`, populated from a task's own persisted
 * `implementation` provenance block (D34/D35, task 15).
 */
export function computeImplementationFingerprintFromProvenance(change, taskId) {
  const task = change.tasks.find(t => t.id === taskId);
  const impl = task?.implementation;
  if (!impl) return computeImplementationFingerprint(change, taskId, {});
  return computeImplementationFingerprint(change, taskId, {
    revision: [impl.baseline_revision || null, impl.review_revision || null],
    evidence: [...(impl.changed_paths || []), impl.worktree_patch_fingerprint || null],
  });
}

// ── Legacy spec fingerprint (whole-file hash) ──────────────────────────────

export function collectSpecFingerprintFiles(change) {
  const files = ['change.yaml'];
  if (existsSync(join(change._dir, 'overview.md'))) files.push('overview.md');
  if (existsSync(join(change._dir, 'owner-decisions.md'))) files.push('owner-decisions.md');
  for (const sub of ['areas', 'tasks']) {
    const dir = join(change._dir, sub);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).sort()) {
      if (entry.endsWith('.md')) files.push(`${sub}/${entry}`);
    }
  }
  return files.sort();
}

export function computeSpecFingerprint(change) {
  const files = collectSpecFingerprintFiles(change);
  const hash = createHash('sha256');
  for (const relPath of files) {
    const content = readUtf8(join(change._dir, ...relPath.split('/')));
    hash.update(relPath);
    hash.update('\n');
    hash.update(content);
    hash.update('\n\x00\n');
  }
  return hash.digest('hex');
}
