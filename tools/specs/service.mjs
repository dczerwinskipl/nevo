// Domain logic for tools/specs.mjs: loading changes, building context packets,
// fingerprinting, and generating indexes. No Commander, no process.argv here.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

import { readUtf8, writeUtf8, resolveWithinBase } from '../lib/fs.mjs';
import { parseYamlFile, parseFrontMatterFile, updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';
import { ACTIVE_CHANGE_STATUSES, isTaskReady } from './lifecycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACTIVE_DIR = join(ROOT, 'specs', 'active');
export const ARCHIVE_DIR = join(ROOT, 'specs', 'archive');
export const ACTIVE_INDEX_MD = join(ROOT, 'specs', 'active.generated.md');
export const ARCHIVE_INDEX_MD = join(ROOT, 'specs', 'archive.generated.md');
export const INDEX_JSON = join(ROOT, 'specs', 'index.generated.json');
const ROUTING_INDEX_FILE = join(ROOT, 'docs', 'routing.generated.json');

// ── Context-completeness / routing precedence (D12, area context-and-
// validation-hardening, task 05) ────────────────────────────────────────────

function globPrefix(pattern) {
  return pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '').replace(/\\/g, '/');
}

// Path-glob-only overlap — no content/semantic search, no repository scan
// (constraint, area context-and-validation-hardening): true when either
// pattern's fixed prefix is an ancestor of (or equal to) the other's.
export function pathGlobsOverlap(a, b) {
  const pa = globPrefix(a);
  const pb = globPrefix(b);
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

function loadRoutingIndex() {
  if (!existsSync(ROUTING_INDEX_FILE)) return null;
  return JSON.parse(readUtf8(ROUTING_INDEX_FILE));
}

// A context_exceptions entry validly suppresses its warning (PR review
// packet 04, Problem 1) only when: its `decision` resolves to a currently
// *active* (non-superseded) owner decision, and `reason` is a non-empty
// string. Exact `omitted` matching only, never substring/approximate — the
// caller compares this entry's `omitted` against a rule's `doc_ref` by
// strict equality.
function isActiveContextException(entry, decisionsMap) {
  if (!entry?.omitted || !entry?.decision || !String(entry?.reason || '').trim()) return false;
  const decision = decisionsMap.get(entry.decision);
  return Boolean(decision && !decision.supersededBy);
}

/**
 * Context-completeness check (requirements 2/3/6): diff routing-table
 * suggestions — sourced only from the already-generated
 * `docs/routing.generated.json`, never the source Markdown at check time —
 * against a task's own declared `context.required`/`optional`. A declared
 * entry always wins (requirement 4/precedence rule) — this only ever adds
 * gap-check candidates, it never removes or overrides one. A *valid*
 * `context_exceptions` entry (see `isActiveContextException`) also suppresses
 * its own specific warning — an invalid one (unresolved/superseded decision,
 * blank reason, or naming a different document) suppresses nothing. A
 * warning, never a hard failure (requirement 3). Pure: `routingIndex` is the
 * already-loaded JSON, or `null` when it hasn't been generated yet.
 */
export function computeRoutingWarnings(
  routingIndex, allowedPaths, declaredContextPaths, contextExceptions = [], decisionsMap = new Map()
) {
  if (!routingIndex) {
    return ['routing index not generated (docs/routing.generated.json) — run `node tools/docs.mjs generate`'];
  }
  const declared = new Set(declaredContextPaths);
  const exempted = new Set(
    contextExceptions.filter(e => isActiveContextException(e, decisionsMap)).map(e => e.omitted)
  );
  const matched = (routingIndex.rules || []).filter(rule =>
    (allowedPaths || []).some(ap => pathGlobsOverlap(ap, rule.path_glob))
  );
  if (!matched.length) {
    return ['no routing rule matched — verify context manually'];
  }
  return matched
    .filter(rule => !declared.has(rule.doc_ref) && !exempted.has(rule.doc_ref))
    .map(rule => `routing rule '${rule.rule_id}' (${rule.path_glob}) suggests '${rule.doc_ref}' — not in this task's declared context`);
}

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/specs.mjs generate -->\n\n';

// ── Change manifest loading ────────────────────────────────────────────────

export function loadChange(slug, baseDir = ACTIVE_DIR) {
  const dir = resolveWithinBase(baseDir, slug);
  const file = join(dir, 'change.yaml');
  if (!existsSync(file)) return null;
  const change = parseYamlFile(file);
  change._slug = slug;
  change._file = file;
  change._dir = dir;
  change.tasks = change.tasks || [];
  change.pull_requests = change.pull_requests === undefined ? [] : change.pull_requests;
  return change;
}

// ── Stable specification identity (D2, area stable-spec-identity, task 01) ─
//
// `spec_id` is an additive, immutable UUID — durable session relations (a
// later task's concern) must resolve to it instead of the mutable slug/`id`.
// Generation, format validation, and the one-time backfill all live here so
// every caller (CLI, spec-create guidance, dashboard) shares one definition.

const SPEC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A canonical random UUID string — Node's own `crypto.randomUUID()`, no new dependency. */
export function generateSpecId() {
  return randomUUID();
}

/** Canonical-UUID-string format check — the only shape `spec_id` may ever take. */
export function isValidSpecId(value) {
  return typeof value === 'string' && SPEC_ID_RE.test(value);
}

/**
 * The identity a durable, non-slug-keyed relation (e.g. a future AI session
 * attachment) must resolve to before reading or writing anything. A legacy
 * manifest with no `spec_id` yet is readable everywhere else in this module,
 * but never usable as a relation key (D2/C2) — this throws an actionable,
 * specific error naming the fix instead of silently falling back to slug.
 */
export function resolveStableSpecId(change) {
  if (isValidSpecId(change.spec_id)) return change.spec_id;
  throw new CliError(
    `Change '${change._slug}' has no persisted spec_id — run 'node tools/specs.mjs backfill-spec-id' ` +
    'before any stable-relation (e.g. AI session) operation.'
  );
}

/**
 * Idempotent backfill (D2, AC3): assigns a fresh, globally unique `spec_id`
 * to every active/archived manifest that doesn't already have a valid one —
 * never rewrites an existing valid value. Uniqueness is checked against every
 * `spec_id` already on disk plus every one assigned earlier in this same run,
 * so two manifests backfilled together can never collide. A second run over
 * unchanged input assigns nothing and writes no file (AC3's "no-op" half).
 */
export function backfillSpecIds({ activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const changes = [...listChanges(activeDir), ...listChanges(archiveDir)];
  const seen = new Set(changes.filter(c => isValidSpecId(c.spec_id)).map(c => c.spec_id));
  const assigned = [];
  for (const change of changes) {
    if (isValidSpecId(change.spec_id)) continue;
    let id = generateSpecId();
    while (seen.has(id)) id = generateSpecId();
    seen.add(id);
    updateYamlFile(change._file, doc => doc.set('spec_id', id));
    assigned.push({ slug: change._slug, file: change._file, specId: id });
  }
  return assigned;
}

const DEFAULT_PULL_REQUEST_BASE_URLS = Object.freeze({
  github: 'https://github.com',
  gitlab: 'https://gitlab.com',
});

/** Normalize the durable, provider-neutral identity stored in change.yaml. */
export function normalizePullRequestReference(reference, label = 'pull request reference') {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new CliError(`${label} must be an object`);
  }

  const provider = String(reference.provider ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider)) {
    throw new CliError(`${label}.provider must be a lowercase provider id (letters, digits, hyphens)`);
  }

  const rawBaseUrl = String(reference.base_url ?? DEFAULT_PULL_REQUEST_BASE_URLS[provider] ?? '').trim();
  if (!rawBaseUrl) {
    throw new CliError(`${label}.base_url is required for provider '${provider}'`);
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username || parsedBaseUrl.password
    || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new CliError(`${label}.base_url must be an absolute http(s) URL without credentials, query, or fragment`);
  }
  const baseUrl = parsedBaseUrl.href.replace(/\/+$/, '');

  let repository = String(reference.repository ?? '').trim().replace(/^\/+|\/+$/g, '');
  repository = repository.replace(/\.git$/i, '');
  const repositoryParts = repository.split('/');
  if (repositoryParts.length < 2
    || repositoryParts.some(part => !part || part === '.' || part === '..')
    || /[\\?#\s]/.test(repository)) {
    throw new CliError(`${label}.repository must be a provider path such as 'owner/repository'`);
  }

  const number = typeof reference.number === 'number'
    ? reference.number
    : Number(String(reference.number ?? '').trim());
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new CliError(`${label}.number must be a positive integer`);
  }

  return { provider, base_url: baseUrl, repository, number };
}

export function pullRequestReferenceKey(reference) {
  const normalized = normalizePullRequestReference(reference);
  return [
    normalized.provider,
    normalized.base_url.toLowerCase(),
    normalized.repository.toLowerCase(),
    normalized.number,
  ].join('|');
}

/** Active-first lookup used by PR attachment and dashboard reads. */
export function loadChangeAnywhere(slug, { activeDir = ACTIVE_DIR, archiveDir = ARCHIVE_DIR } = {}) {
  const active = loadChange(slug, activeDir);
  if (active) return { change: active, location: 'active' };
  const archived = loadChange(slug, archiveDir);
  if (archived) return { change: archived, location: 'archive' };
  return null;
}

/** Single structural write path for appending a normalized reference. */
export function addPullRequestReference(change, reference) {
  const normalized = normalizePullRequestReference(reference);
  const key = pullRequestReferenceKey(normalized);
  if ((change.pull_requests || []).some(item => pullRequestReferenceKey(item) === key)) {
    return { added: false, reference: normalized };
  }

  updateYamlFile(change._file, doc => {
    if (!doc.has('pull_requests')) doc.set('pull_requests', []);
    const references = doc.get('pull_requests', true);
    if (Array.isArray(references)) {
      references.push(normalized);
      doc.set('pull_requests', references);
    } else if (references && typeof references.add === 'function') {
      references.flow = false;
      references.add(normalized);
    } else {
      throw new CliError(`pull_requests must be an array in ${change._file}`);
    }
  });
  change.pull_requests = [...(change.pull_requests || []), normalized];
  return { added: true, reference: normalized };
}

export function listChanges(dir = ACTIVE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => {
      const full = join(dir, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'change.yaml'));
    })
    .map(slug => loadChange(slug, dir))
    .filter(Boolean);
}

/** Structural update: set one task's status in change.yaml, preserving comments/formatting. */
export function setTaskStatus(change, taskId, status) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('status', status);
  });
}

/** Structural update: set the change's top-level status in change.yaml. */
export function setChangeStatus(change, status) {
  updateYamlFile(change._file, doc => doc.set('status', status));
}

/**
 * The single write path for `/nevo-ai:implementation-review`'s bulk status
 * transition (D30, task 12, area implementation-review-orchestration
 * requirement 12) — one read-modify-write of `change.yaml` covering every
 * eligible task's transition together, never one write per task.
 * `transitions` is `validateBulkTransition`'s own output (`tools/specs/lifecycle.mjs`) — already validated for every task before this is ever
 * called; this function performs no validation of its own, only the write.
 * A `noop` entry (already at or past the target status) is skipped — its
 * `status` field is never rewritten to the same value.
 */
export function writeBulkTransition(change, transitions) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    for (const t of transitions) {
      if (t.noop) continue;
      const item = tasks?.items?.find(it => it.get('id') === t.id);
      if (!item) throw new CliError(`Task '${t.id}' not found in ${change._file}`);
      item.set('status', t.to);
    }
  });
}

// ── Context packet ─────────────────────────────────────────────────────────

export function buildContextPacket(change, task) {
  const taskFile = task.file ? resolveWithinBase(change._dir, task.file) : null;
  const taskFm = taskFile ? parseFrontMatterFile(taskFile) : {};

  const branchMode = change.branch?.mode || 'per-change';
  const prefix = change.branch?.prefix || 'feature';
  const branch = branchMode === 'per-task'
    ? `${prefix}/${change._slug}/${task.id}`
    : `${prefix}/${change._slug}`;

  const contextRequired = (taskFm.context?.required || []).map(p =>
    p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
  );
  const contextOptional = (taskFm.context?.optional || []).map(p =>
    p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
  );
  const allowedPaths = taskFm.allowed_paths || [];
  const consequentialPaths = taskFm.consequential_paths || [];
  const contextExceptions = taskFm.context_exceptions || [];
  const decisionsMap = parseOwnerDecisions(readIfExists(join(change._dir, 'owner-decisions.md')));

  return {
    change: { id: change.id, title: change.title, specId: change.spec_id ?? null },
    task: {
      id: task.id,
      file: task.file ? `specs/active/${change._slug}/${task.file}` : null,
    },
    context: { required: contextRequired, optional: contextOptional },
    allowed_paths: allowedPaths,
    // Kept as its own field, not merged into allowed_paths (PR review packet
    // 04, Problem 2) — the two carry different review semantics (a
    // consequential write is never a scope violation at task-review time;
    // an allowed_paths write is the task's primary declared scope).
    consequential_paths: consequentialPaths,
    context_exceptions: contextExceptions,
    forbidden_paths: taskFm.forbidden_paths || [],
    branch,
    routingWarnings: computeRoutingWarnings(
      loadRoutingIndex(),
      [...allowedPaths, ...consequentialPaths], // a doc may be relevant via a consequential write too
      [...contextRequired, ...contextOptional],
      contextExceptions,
      decisionsMap
    ),
  };
}

// ── Next task selection ────────────────────────────────────────────────────

export function getNext() {
  const changes = listChanges().filter(c => ACTIVE_CHANGE_STATUSES.has(c.status));

  const candidates = [];
  for (const change of changes) {
    for (const task of change.tasks) {
      if (isTaskReady(task, change)) {
        candidates.push({ change, task });
      }
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const pa = a.change.priority ?? 999;
    const pb = b.change.priority ?? 999;
    if (pa !== pb) return pa - pb;
    if (a.task.order !== b.task.order) return (a.task.order ?? 999) - (b.task.order ?? 999);
    return a.change._slug.localeCompare(b.change._slug);
  });

  return buildContextPacket(candidates[0].change, candidates[0].task);
}

// ── Deterministic spec fingerprint ─────────────────────────────────────────
//
// A hash over the specification inputs that matter for approval readiness —
// deliberately excluding `reviews/**` so writing a review never invalidates
// its own fingerprint.

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

export function loadReview(change) {
  const file = join(change._dir, 'reviews', 'spec.md');
  if (!existsSync(file)) return null;
  return parseFrontMatterFile(file);
}

// ── Follow-up ledger — mutable YAML, not append-only (D15, D22, task 06) ───

export const FOLLOW_UP_STATUSES = new Set(['open', 'resolved', 'dismissed']);
export const FOLLOW_UP_SEVERITIES = new Set(['blocking', 'non-blocking']);

function followUpsFile(change) {
  return join(change._dir, 'follow-ups.yaml');
}

/** Load a change's follow-up ledger, or `{ follow_ups: [] }` if it has none yet. */
export function loadFollowUps(change) {
  const file = followUpsFile(change);
  if (!existsSync(file)) return { follow_ups: [] };
  return parseYamlFile(file) || { follow_ups: [] };
}

/**
 * Record a new follow-up entry (`task-review`/`spec-audit`'s "record as
 * follow-up" action for a `NON_BLOCKING` finding) — always a fresh `id`,
 * creates `follow-ups.yaml` if this is the change's first entry.
 */
export function addFollowUp(change, entry) {
  const file = followUpsFile(change);
  if (!existsSync(file)) writeUtf8(file, 'follow_ups: []\n');
  updateYamlFile(file, doc => {
    const list = doc.get('follow_ups', true);
    list.flow = false; // block style — an empty [] node otherwise stays flow-style once populated
    list.add(entry);
  });
}

/**
 * Mutate an existing follow-up entry's `status`/`resolution` in place — D15's
 * "mutable current-state list, not append-only": a resolve/dismiss action
 * changes the existing entry, it never appends a duplicate for the same
 * follow-up (AC4).
 */
export function resolveFollowUp(change, id, { status, resolution, decisionRef = null }) {
  const file = followUpsFile(change);
  updateYamlFile(file, doc => {
    const list = doc.get('follow_ups', true);
    const item = list?.items?.find(it => it.get('id') === id);
    if (!item) throw new CliError(`Follow-up '${id}' not found in ${file}`);
    item.set('status', status);
    item.set('resolution', resolution);
    // A structured reference (PR review packet 05B, Problem 1) — never a
    // regex scan over `resolution`'s free-form prose for an incidental
    // 'D<n>' mention. Only set when given; a non-blocking dismissal or a
    // plain resolve has no decision to record.
    if (decisionRef) item.set('decision_ref', decisionRef);
  });
}

// ── Three-tier canonical semantic fingerprint (D7, D18, D27, D28) ──────────
//
// Replaces the single whole-file-hash model's *design intent*
// (`computeSpecFingerprint` above stays in place — it is still what
// tools/specs.mjs's approve gate reads, and rewiring that call site is
// outside this task's allowed_paths). Each function extracts specific
// semantic fields from parsed structures and hashes that projection — never
// raw file bytes — so `status`, `execution.suspension`, and `self_check` are
// simply never read here, not excluded after the fact.

// Fields whose *membership*, not order, is the semantic fact — YAML authors
// reordering one of these must never change the fingerprint. Object-valued
// entries (e.g. context_exceptions' {omitted, decision, reason} tuples) sort
// by their own canonical JSON form, which is itself key-order-independent
// (stableStringify is applied recursively before the sort).
const SET_LIKE_KEYS = new Set([
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
function stableStringify(value, keyHint) {
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

function hashProjection(parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(typeof part === 'string' ? part : stableStringify(part));
    hash.update('\n\x00\n');
  }
  return hash.digest('hex');
}

function readIfExists(path) {
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
function resolveActiveDecisionText(decisionsMap, id, seen = new Set()) {
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
 * `depends_on` edges only, never per-task status). Owner-decision text flows
 * into the fingerprint system at the task tier instead (via
 * `semantic_references.decisions`, D18) — decisions embedded directly in
 * `overview.md`'s own architecture prose already invalidate this tier
 * through `overview.md` itself; decisions relevant only to one task's
 * content are exactly the case D18 scopes to that task's own fingerprint,
 * not this one.
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

/**
 * `computeTaskFingerprint(change, taskId)` — a canonical projection over that
 * task's own definition (its file's body — goal, constraints, acceptance
 * criteria, out-of-scope — excluding its front matter's `status`, which is
 * simply never read), `allowed_paths`/`consequential_paths`/`forbidden_paths`,
 * `context`, `context_exceptions` (D13, reserved — task 06 populates it),
 * this task's own `depends_on` edges (its prerequisites/ordering, distinct
 * from which of them are semantically load-bearing), and
 * `semantic_references` (D18) — resolved, not just echoed: each referenced
 * decision/constraint's own current text, and each `dependency_contracts`
 * entry's own task-level fingerprint (recursively), so a change to any of
 * them propagates here without a separate prose-inference step.
 */
export function computeTaskFingerprint(change, taskId, seen = new Set()) {
  const task = change.tasks.find(t => t.id === taskId);
  if (!task || !task.file) return hashProjection(['task-fingerprint-v1', taskId, 'missing']);

  const { fm, body } = loadTaskFileParts(change, task);
  const sr = fm.semantic_references || {};

  // `semantic_references` itself is deliberately not included here: its
  // resolved content (decisionTexts/constraintTexts/dependencyFingerprints,
  // below — each already sorted) fully represents what it contributes to
  // this fingerprint. Including the raw block too would hash the same
  // semantic data twice — once raw (order-sensitive), once resolved
  // (order-independent) — so reordering a set-like semantic_references list
  // would falsely invalidate the fingerprint despite `stableStringify`'s own
  // set-like handling below already covering `context_exceptions`/
  // `allowed_paths`/etc.
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
 * fingerprint plus a reviewed diff/revision identifier and evidence
 * references. This task only defines the function's contract; populating
 * real revision/evidence data is later tasks' job (task 08's self-check,
 * task 08/area `batch-execution-and-gating-review`'s evidence model).
 */
export function computeImplementationFingerprint(change, taskId, { revision = null, evidence = [] } = {}) {
  const taskFingerprint = computeTaskFingerprint(change, taskId);
  return hashProjection(['implementation-fingerprint-v1', taskFingerprint, revision, evidence]);
}

/**
 * `computeImplementationFingerprint`, populated from a task's own persisted
 * `implementation` provenance block (D34/D35, task 15 — area
 * implementation-provenance-and-attribution) instead of requiring the caller
 * to supply `revision`/`evidence` by hand. Closes the gap this function's own
 * original doc comment named ("populating real revision/evidence data is
 * later tasks' job"). A task with no persisted `implementation` block yet
 * still gets a real fingerprint — `revision`/`evidence` are simply `null`/`[]`,
 * the same defaults `computeImplementationFingerprint` already has.
 *
 * Corrected (seventh refinement pass, owner review): the original version
 * folded `baseline_revision`/`review_revision` together with `||` (only one
 * ever reached the hash) and never fed `worktree_patch_fingerprint` into the
 * hash at all, so two different implementations sharing a `baseline_revision`
 * and `changed_paths` list but differing only in uncommitted content — the
 * one case `worktree_patch_fingerprint` exists to distinguish — produced the
 * same implementation fingerprint. `revision` now carries both persisted
 * revision markers (as a pair, not an `||` fallback) and `evidence` carries
 * `worktree_patch_fingerprint` alongside `changed_paths`, so every field the
 * `implementation` schema (area requirement 1) persists actually
 * participates in the hash. `computeImplementationFingerprint`'s own
 * `{ revision, evidence }` contract is unchanged — only the data supplied at
 * this call site is richer.
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

// ── Implementation provenance (D34/D35, task 15) ────────────────────────────
//
// The single write path for `implementation` — no other code sets this field
// (same constraint pattern as `self_check`/`execution.suspension`).

/** Write `task`'s `implementation` provenance block — overwrites any prior value. */
export function writeImplementationProvenance(change, taskId, implementation) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('implementation', implementation);
  });
}

// ── Self-check writer (D28, task 08) ────────────────────────────────────────
//
// The single write path for `self_check` — no other code sets this field
// (constraint, area batch-execution-and-gating-review).

/** Parse a task's "## Verification" fenced code block into one command string per line. */
export function parseVerificationCommands(body) {
  const match = body.match(/##\s*Verification\s*\r?\n+```[a-zA-Z]*\r?\n([\s\S]*?)```/i);
  if (!match) return [];
  return match[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/** Write `task`'s `self_check` block (task 01's validated shape) — overwrites any prior value. */
export function writeSelfCheck(change, taskId, selfCheck) {
  updateYamlFile(change._file, doc => {
    const tasks = doc.get('tasks', true);
    const item = tasks?.items?.find(it => it.get('id') === taskId);
    if (!item) throw new CliError(`Task '${taskId}' not found in ${change._file}`);
    item.set('self_check', selfCheck);
  });
}

// ── Batch intent — persisted intent only, progress is always derived (D10) ─

function batchIntentFile(change) {
  return join(change._dir, 'batch.json');
}

/** Load a change's active batch intent, or `null` if none is in progress. */
export function loadBatchIntent(change) {
  const file = batchIntentFile(change);
  if (!existsSync(file)) return null;
  const raw = readUtf8(file);
  if (!raw.trim()) return null; // cleared (clearBatchIntent's empty-file convention)
  return JSON.parse(raw);
}

/**
 * Persist a new batch's intent — `change`, `requestedTasks`, `orderedTasks`,
 * `startRevision`, `reviewMode`, `checkpointPolicy`, `temporaryInconsistencies`
 * only (requirement — no `completed`/`current`/`next`/`failed` field; those
 * are always `deriveBatchProgress`'s job).
 */
export function writeBatchIntent(change, intent) {
  writeUtf8(batchIntentFile(change), JSON.stringify(intent, null, 2));
}

/** Clear a change's batch intent file once the batch is done (or abandoned). */
export function clearBatchIntent(change) {
  const file = batchIntentFile(change);
  if (existsSync(file)) writeUtf8(file, '');
  // An empty file, not a deleted one — this module never deletes files
  // (mirrors the rest of tools/lib/fs.mjs's usage in this codebase); loadBatchIntent
  // treats an empty file the same as a missing one (JSON.parse('') fails, so
  // check emptiness first here, not there).
}

// ── Index generation: build (pure, deterministic) + write (I/O) ────────────

// `blocked`/`needs-decision` are removed from the vocabulary (D16); `superseded`
// was never set by any code path and carried no real semantics — removed rather
// than given a fabricated meaning (D6/requirement 5).
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
 * repository's own paths (D34/D35, task 20, closes FU-007) — a fixture-backed
 * test passes its own temp directories without touching the real checkout.
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
 * ignoring the JSON timestamp. All five paths default to the real
 * repository's own (D34/D35, task 20, closes FU-007) — a fixture-backed test
 * passes its own temp paths for every one, so a deliberately stale/missing
 * generated file (the REC-03 scenario) can be reproduced without corrupting
 * the real repository's own generated files.
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
