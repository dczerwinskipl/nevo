#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|fingerprint|approve|start|complete|verify|archive>

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const ACTIVE_DIR = join(ROOT, 'specs', 'active');
const ARCHIVE_DIR = join(ROOT, 'specs', 'archive');
const ACTIVE_INDEX_MD = join(ROOT, 'specs', 'active.generated.md');
const ARCHIVE_INDEX_MD = join(ROOT, 'specs', 'archive.generated.md');
const INDEX_JSON = join(ROOT, 'specs', 'index.generated.json');

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/specs.mjs generate -->\n\n';

// ── YAML subset parser ─────────────────────────────────────────────────────
//
// Supports: flat/nested mappings, block lists, list-of-mappings, quoted and
// unquoted scalars, booleans, null/~, integers, and the inline empty-list
// literal `[]` (needed for `context: { required: [] }`-style front matter).
// Inline `{}` is deliberately NOT supported — nothing in this repository's
// spec/task/doc schema uses an inline empty mapping, and the custom parser
// should not grow syntax the schema doesn't need (see ADR-0003/0004's
// anti-over-engineering stance). If a real need for it shows up, add it back
// alongside a test, the same way `[]` was added for a real, demonstrated bug.

export function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;

  function indent(line) { return line.match(/^(\s*)/)[1].length; }

  function parseScalar(s) {
    s = s.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (s === '[]') return [];
    if (/^-?\d+$/.test(s)) return Number(s);
    if (/^['"].*['"]$/.test(s)) return s.slice(1, -1);
    return s;
  }

  function parseBlock(minIndent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
      const li = indent(line);
      if (li < minIndent) break;
      const colon = line.indexOf(':');
      if (colon === -1) { i++; continue; }
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      i++;
      if (rest === '' || rest === '>') {
        if (i >= lines.length) { obj[key] = null; continue; }
        const next = lines[i];
        if (!next.trim()) { obj[key] = null; continue; }
        const ni = indent(next);
        if (ni <= li) { obj[key] = null; continue; }
        if (next.trim().startsWith('- ')) {
          obj[key] = parseList(ni);
        } else {
          obj[key] = parseBlock(ni);
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(minIndent) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
      const li = indent(line);
      if (li < minIndent) break;
      const content = line.trim();
      if (!content.startsWith('- ')) break;
      i++;
      const itemStr = content.slice(2).trim();
      if (itemStr === '') {
        // Object item — properties on following lines
        if (i < lines.length) {
          const nextIndent = indent(lines[i]);
          arr.push(parseBlock(nextIndent));
        }
      } else {
        const colonIdx = itemStr.indexOf(':');
        const looksLikeKey = colonIdx > 0 && !/^['"]/.test(itemStr);
        if (looksLikeKey) {
          // Inline-started object: "- id: value\n    key2: val2"
          const firstKey = itemStr.slice(0, colonIdx).trim();
          const firstVal = itemStr.slice(colonIdx + 1).trim();
          const subObj = { [firstKey]: parseScalar(firstVal) };
          if (i < lines.length) {
            const nextLi = indent(lines[i]);
            if (nextLi > li) Object.assign(subObj, parseBlock(nextLi));
          }
          arr.push(subObj);
        } else {
          arr.push(parseScalar(itemStr));
        }
      }
    }
    return arr;
  }

  return parseBlock(0);
}

// ── Change manifest loading ────────────────────────────────────────────────

export function loadChange(slug, baseDir = ACTIVE_DIR) {
  const file = join(baseDir, slug, 'change.yaml');
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8');
  const change = parseYaml(raw);
  change._slug = slug;
  change._file = file;
  change._dir = join(baseDir, slug);
  change.tasks = change.tasks || [];
  return change;
}

function saveChange(change) {
  const output = readFileSync(change._file, 'utf8');
  // Update task statuses via line replacement
  let updated = output;
  for (const task of change._pendingUpdates || []) {
    // Replace status line for specific task
    const taskRegex = new RegExp(`(\\s+- id: ${task.id}[\\s\\S]*?status: )([a-z-]+)`, 'm');
    updated = updated.replace(taskRegex, `$1${task.status}`);
  }
  // Update top-level status if changed
  if (change._newStatus) {
    updated = updated.replace(/^status: \S+/m, `status: ${change._newStatus}`);
  }
  writeFileSync(change._file, updated);
}

function listChanges(dir = ACTIVE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => {
      const full = join(dir, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'change.yaml'));
    })
    .map(slug => loadChange(slug, dir))
    .filter(Boolean);
}

// ── Task readiness ─────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['implemented', 'verified', 'archived', 'abandoned']);
const READY_STATUSES = new Set(['approved']);
const ACTIVE_CHANGE_STATUSES = new Set(['approved', 'in-implementation', 'needs-decision', 'draft', 'blocked']);

export function depsSatisfied(task, change) {
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = change.tasks.find(t => t.id === depId);
    return Boolean(dep) && TERMINAL_STATUSES.has(dep.status);
  });
}

function isTaskReady(task, change) {
  return READY_STATUSES.has(task.status) && depsSatisfied(task, change);
}

// ── Task lifecycle state machine ───────────────────────────────────────────
//
// The one place task status transitions are defined. Every command that
// changes a task's status validates against this table instead of assigning
// an arbitrary status — see docs/ai/specification-workflow.md and
// references/review-policy.md for the policy this enforces.

export const TRANSITIONS = {
  approve: { from: 'draft', to: 'approved' },
  start: { from: 'approved', to: 'in-implementation' },
  complete: { from: 'in-implementation', to: 'implemented' },
  verify: { from: 'implemented', to: 'verified' },
};

/**
 * Validate a status transition for `command` against the task's current
 * status. Returns `{ ok: true, idempotent: boolean }` on success —
 * `idempotent: true` means the task is already at the target status, which
 * is treated as a safe no-op (re-running a command should not be an error),
 * never as license to skip a transition's own gate checks the first time it
 * actually runs. Returns `{ ok: false, reason }` for any other status.
 */
export function validateTransition(command, currentStatus) {
  const rule = TRANSITIONS[command];
  if (!rule) throw new Error(`Unknown transition command '${command}'`);
  if (currentStatus === rule.to) return { ok: true, idempotent: true };
  if (currentStatus !== rule.from) {
    return {
      ok: false,
      reason: `Task has status '${currentStatus}' — '${command}' requires status '${rule.from}'.`,
    };
  }
  return { ok: true, idempotent: false };
}

// ── Next task selection ────────────────────────────────────────────────────

function getNext() {
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

// ── Context packet ─────────────────────────────────────────────────────────

function parseFrontMatterFile(file) {
  if (!existsSync(file)) return {};
  const content = readFileSync(file, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return parseYaml(match[1]);
}

function buildContextPacket(change, task) {
  const taskFile = task.file ? join(change._dir, task.file) : null;
  const taskFm = taskFile ? parseFrontMatterFile(taskFile) : {};

  const branchMode = change.branch?.mode || 'per-change';
  const prefix = change.branch?.prefix || 'feature';
  const branch = branchMode === 'per-task'
    ? `${prefix}/${change._slug}/${task.id}`
    : `${prefix}/${change._slug}`;

  return {
    change: { id: change.id, title: change.title },
    task: {
      id: task.id,
      file: task.file ? `specs/active/${change._slug}/${task.file}` : null,
    },
    context: {
      required: (taskFm.context?.required || []).map(p =>
        p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
      ),
      optional: (taskFm.context?.optional || []).map(p =>
        p.startsWith('../') ? join('specs/active', change._slug, p).replace(/\\/g, '/') : p
      ),
    },
    allowed_paths: taskFm.allowed_paths || [],
    forbidden_paths: taskFm.forbidden_paths || [],
    branch,
  };
}

// ── Deterministic spec fingerprint ─────────────────────────────────────────
//
// A hash over the specification inputs that matter for approval readiness —
// deliberately excluding `reviews/**` so writing a review never invalidates
// its own fingerprint. `/nevo-ai:spec-review` must call `fingerprint` and
// embed the exact printed value; it must never be guessed or reasoned about
// by a model, since that would not be deterministic.

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
    const content = readFileSync(join(change._dir, ...relPath.split('/')), 'utf8');
    hash.update(relPath);
    hash.update('\n');
    hash.update(content);
    hash.update('\n\x00\n');
  }
  return hash.digest('hex');
}

function loadReview(change) {
  const file = join(change._dir, 'reviews', 'spec.md');
  if (!existsSync(file)) return null;
  return parseFrontMatterFile(file);
}

/**
 * Pure approval-gate check: given a task's current status, its change's review
 * front matter (or null if no review file exists), and the freshly-computed current
 * spec fingerprint, decide whether `approve` may proceed. Does not touch the
 * filesystem or process — see the `approve` CLI case for the I/O around this.
 *
 * Returns `{ ok: true, idempotent: boolean }` or `{ ok: false, reason }`.
 */
export function validateApproval(taskStatus, review, currentFingerprint) {
  const transition = validateTransition('approve', taskStatus);
  if (!transition.ok) return transition;
  if (transition.idempotent) return transition;

  if (!review) {
    return {
      ok: false,
      reason: 'No review found. A specification review must exist before a task can be approved.',
    };
  }
  if (review.verdict !== 'ready-for-approval') {
    return { ok: false, reason: `Review verdict is '${review.verdict}', not 'ready-for-approval'. Cannot approve.` };
  }

  const unresolvedFixes = Number(review.unresolved_required_fixes ?? 0);
  const unresolvedDecisions = Number(review.unresolved_owner_decisions ?? 0);
  const unresolvedClarifications = Number(review.unresolved_needs_clarification ?? 0);
  if (unresolvedFixes > 0 || unresolvedDecisions > 0 || unresolvedClarifications > 0) {
    return {
      ok: false,
      reason: `Review has unresolved items (required fixes: ${unresolvedFixes}, ` +
        `owner decisions: ${unresolvedDecisions}, needs clarification: ${unresolvedClarifications}). ` +
        `Cannot approve.`,
    };
  }

  if (!review.spec_fingerprint) {
    return {
      ok: false,
      reason: `Review is missing 'spec_fingerprint' front matter — it predates this check. ` +
        `Re-run the review before approving.`,
    };
  }
  if (review.spec_fingerprint !== currentFingerprint) {
    return {
      ok: false,
      reason: `Review is stale: its spec_fingerprint (${review.spec_fingerprint}) does not match ` +
        `the current specification state (${currentFingerprint}). Re-run the review before approving.`,
    };
  }

  return { ok: true, idempotent: false };
}

// ── Git helpers ────────────────────────────────────────────────────────────

function git(cmd) { return execSync(`git -C "${ROOT}" ${cmd}`, { encoding: 'utf8' }).trim(); }

function isWorkingTreeClean() {
  return git('status --porcelain') === '';
}

function branchExists(name) {
  try { git(`rev-parse --verify "${name}"`); return true; } catch { return false; }
}

// ── Index generation ───────────────────────────────────────────────────────

const STATUS_ORDER = [
  'in-implementation', 'approved', 'needs-decision', 'draft', 'blocked',
  'implemented', 'verified', 'abandoned', 'superseded', 'archived',
];

function generateIndexes() {
  const active = listChanges(ACTIVE_DIR);
  const archive = listChanges(ARCHIVE_DIR);

  active.sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status);
    const sb = STATUS_ORDER.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return (a.priority ?? 999) - (b.priority ?? 999);
  });

  const toRow = c =>
    `| \`${c.id}\` | ${c.title} | ${c.status} | ${c.priority ?? '-'} | ${c.created ?? '-'} |\n`;

  const header = '| ID | Title | Status | Priority | Created |\n|---|---|---|---|---|\n';

  let activeMd = GENERATED_NOTICE + '# Active specifications\n\n' + header;
  for (const c of active) activeMd += toRow(c);

  let archiveMd = GENERATED_NOTICE + '# Archived specifications\n\n' + header;
  for (const c of archive) archiveMd += toRow(c);

  writeFileSync(ACTIVE_INDEX_MD, activeMd);
  writeFileSync(ARCHIVE_INDEX_MD, archiveMd);

  const allChanges = [...active, ...archive].map(c => ({
    id: c.id, title: c.title, status: c.status, priority: c.priority,
    created: c.created, tasks: c.tasks,
  }));
  writeFileSync(INDEX_JSON, JSON.stringify({ generated: new Date().toISOString(), changes: allChanges }, null, 2));

  console.log(`Generated: specs/active.generated.md (${active.length} changes)`);
  console.log(`Generated: specs/archive.generated.md (${archive.length} changes)`);
  console.log(`Generated: specs/index.generated.json`);
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateSpecs() {
  const errors = [];
  const changes = [...listChanges(ACTIVE_DIR), ...listChanges(ARCHIVE_DIR)];

  for (const change of changes) {
    if (!change.id) errors.push(`${change._file}: missing 'id'`);
    if (!change.title) errors.push(`${change._file}: missing 'title'`);
    if (!change.status) errors.push(`${change._file}: missing 'status'`);

    const ids = new Set();
    for (const task of change.tasks) {
      if (!task.id) { errors.push(`${change._file}: task missing 'id'`); continue; }
      if (ids.has(task.id)) errors.push(`${change._file}: duplicate task id '${task.id}'`);
      ids.add(task.id);

      for (const dep of task.depends_on || []) {
        if (!ids.has(dep) && !change.tasks.find(t => t.id === dep)) {
          errors.push(`${change._file}: task '${task.id}' depends_on unknown task '${dep}'`);
        }
      }

      if (task.file) {
        const taskFile = join(change._dir, task.file);
        if (!existsSync(taskFile)) {
          errors.push(`${change._file}: task '${task.id}' file not found: ${task.file}`);
        }
      }
    }

    // Cycle detection: DFS with path tracking (handles diamond deps correctly)
    const safelyExplored = new Set();
    const dfs = (id, path) => {
      if (path.has(id)) { errors.push(`${change._file}: dependency cycle involving '${id}'`); return; }
      if (safelyExplored.has(id)) return;
      path.add(id);
      const t = change.tasks.find(t => t.id === id);
      for (const d of t?.depends_on || []) dfs(d, path);
      path.delete(id);
      safelyExplored.add(id);
    };
    for (const task of change.tasks) dfs(task.id, new Set());
  }
  return errors;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function runCli() {
  const [, , cmd, changeSlug, taskId] = process.argv;

  switch (cmd) {

    case 'generate': {
      const errors = validateSpecs();
      if (errors.length) { errors.forEach(e => console.error(e)); process.exit(1); }
      generateIndexes();
      break;
    }

    case 'validate': {
      const errors = validateSpecs();
      if (errors.length) { errors.forEach(e => console.error(e)); process.exit(1); }
      const n = listChanges(ACTIVE_DIR).length + listChanges(ARCHIVE_DIR).length;
      console.log(`Validated ${n} changes — no errors.`);
      break;
    }

    case 'check': {
      const errors = validateSpecs();
      if (errors.length) { errors.forEach(e => console.error(e)); process.exit(1); }
      if (!existsSync(INDEX_JSON)) {
        console.error('specs/index.generated.json missing — run: node tools/specs.mjs generate');
        process.exit(1);
      }
      console.log('Specs valid and indexes exist.');
      break;
    }

    case 'list': {
      const changes = listChanges(ACTIVE_DIR);
      if (!changes.length) { console.log('No active changes.'); break; }
      for (const c of changes) {
        console.log(`\n[${c.status}] ${c.id} — ${c.title} (priority: ${c.priority ?? '-'})`);
        for (const t of c.tasks) {
          const ready = isTaskReady(t, c) ? ' ✓' : '';
          console.log(`  ${t.order ?? '-'}. [${t.status}] ${t.id}${ready}`);
        }
      }
      break;
    }

    case 'next': {
      const packet = getNext();
      if (!packet) { console.log('No approved tasks ready.'); break; }
      console.log(JSON.stringify(packet, null, 2));
      break;
    }

    case 'context': {
      if (!changeSlug || !taskId) { console.error('Usage: specs.mjs context <change> <task>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found in specs/active/`); process.exit(1); }
      const task = change.tasks.find(t => t.id === taskId);
      if (!task) { console.error(`Task '${taskId}' not found in change '${changeSlug}'`); process.exit(1); }
      console.log(JSON.stringify(buildContextPacket(change, task), null, 2));
      break;
    }

    case 'fingerprint': {
      if (!changeSlug) { console.error('Usage: specs.mjs fingerprint <change>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      console.log(computeSpecFingerprint(change));
      break;
    }

    case 'approve': {
      if (!changeSlug || !taskId) { console.error('Usage: specs.mjs approve <change> <task>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      const task = change.tasks.find(t => t.id === taskId);
      if (!task) { console.error(`Task '${taskId}' not found`); process.exit(1); }

      const review = loadReview(change);
      const currentFingerprint = computeSpecFingerprint(change);
      const result = validateApproval(task.status, review, currentFingerprint);

      if (!result.ok) { console.error(result.reason); process.exit(1); }
      if (result.idempotent) { console.log(`Task '${taskId}' is already approved.`); break; }

      change._pendingUpdates = [{ id: taskId, status: 'approved' }];
      saveChange(change);
      console.log(`Task '${taskId}' marked as approved.`);
      break;
    }

    case 'start': {
      if (!changeSlug || !taskId) { console.error('Usage: specs.mjs start <change> <task>'); process.exit(1); }

      if (!isWorkingTreeClean()) {
        console.error('Working tree has uncommitted changes. Stash or commit before starting a task.');
        process.exit(1);
      }

      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      const task = change.tasks.find(t => t.id === taskId);
      if (!task) { console.error(`Task '${taskId}' not found`); process.exit(1); }

      const transition = validateTransition('start', task.status);
      if (!transition.ok) { console.error(transition.reason); process.exit(1); }
      if (!transition.idempotent && !depsSatisfied(task, change)) {
        console.error(`Task '${taskId}' has unsatisfied dependencies: ${(task.depends_on || []).join(', ')}`);
        process.exit(1);
      }

      const packet = buildContextPacket(change, task);
      const branch = packet.branch;

      if (!branchExists(branch)) {
        git(`checkout -b "${branch}"`);
        console.log(`Created branch: ${branch}`);
      } else {
        git(`checkout "${branch}"`);
        console.log(`Switched to branch: ${branch}`);
      }

      if (transition.idempotent) {
        console.log(`Task '${taskId}' is already in-implementation.`);
      } else {
        change._pendingUpdates = [{ id: taskId, status: 'in-implementation' }];
        saveChange(change);
        console.log(`Task '${taskId}' set to in-implementation.`);
      }
      console.log('\nContext packet:');
      console.log(JSON.stringify(packet, null, 2));
      break;
    }

    case 'complete': {
      if (!changeSlug || !taskId) { console.error('Usage: specs.mjs complete <change> <task>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      const task = change.tasks.find(t => t.id === taskId);
      if (!task) { console.error(`Task '${taskId}' not found`); process.exit(1); }

      const transition = validateTransition('complete', task.status);
      if (!transition.ok) { console.error(transition.reason); process.exit(1); }
      if (transition.idempotent) { console.log(`Task '${taskId}' is already implemented.`); break; }

      change._pendingUpdates = [{ id: taskId, status: 'implemented' }];
      saveChange(change);
      console.log(`Task '${taskId}' marked as implemented. Present results to owner for verification.`);
      break;
    }

    case 'verify': {
      if (!changeSlug || !taskId) { console.error('Usage: specs.mjs verify <change> <task>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      const task = change.tasks.find(t => t.id === taskId);
      if (!task) { console.error(`Task '${taskId}' not found`); process.exit(1); }

      const transition = validateTransition('verify', task.status);
      if (!transition.ok) { console.error(transition.reason); process.exit(1); }
      if (transition.idempotent) { console.log(`Task '${taskId}' is already verified.`); break; }

      change._pendingUpdates = [{ id: taskId, status: 'verified' }];
      saveChange(change);
      console.log(`Task '${taskId}' marked as verified.`);
      break;
    }

    case 'archive': {
      if (!changeSlug) { console.error('Usage: specs.mjs archive <change>'); process.exit(1); }
      const change = loadChange(changeSlug);
      if (!change) { console.error(`Change '${changeSlug}' not found`); process.exit(1); }
      const allDone = change.tasks.every(t => TERMINAL_STATUSES.has(t.status));
      if (!allDone) {
        console.error('Not all tasks are in a terminal status. Cannot archive.');
        process.exit(1);
      }
      const dest = join(ARCHIVE_DIR, changeSlug);
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      renameSync(change._dir, dest);
      generateIndexes();
      console.log(`Change '${changeSlug}' archived to specs/archive/.`);
      break;
    }

    default:
      console.log([
        'Usage: node tools/specs.mjs <command>',
        '',
        'Commands:',
        '  generate                  Rebuild generated indexes',
        '  validate                  Validate all change manifests',
        '  check                     Validate + check indexes are current',
        '  list                      List active changes and task statuses',
        '  next                      Select next approved ready task → JSON',
        '  context <change> <task>   Print context packet → JSON',
        '  fingerprint <change>      Print a deterministic hash of the spec inputs',
        '  approve <change> <task>   Mark task as approved (requires a clean, ready review)',
        '  start <change> <task>     Create branch, set task in-implementation',
        '  complete <change> <task>  Mark task as implemented',
        '  verify <change> <task>    Mark task as verified',
        '  archive <change>          Move change to specs/archive/',
      ].join('\n'));
      process.exit(1);
  }
}

// Only run the CLI when this file is executed directly (`node tools/specs.mjs
// ...`), not when it's imported — e.g. by tests importing the exported pure
// functions above. Prevents `process.exit()` calls (including the default
// case's usage-and-exit-1) from firing on import.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  runCli();
}
