#!/usr/bin/env node
// tools/specs.mjs — specification lifecycle CLI
// Usage: node tools/specs.mjs <generate|validate|check|list|next|context|start|complete|verify|archive>

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const ACTIVE_DIR = join(ROOT, 'specs', 'active');
const ARCHIVE_DIR = join(ROOT, 'specs', 'archive');
const ACTIVE_INDEX_MD = join(ROOT, 'specs', 'active.generated.md');
const ARCHIVE_INDEX_MD = join(ROOT, 'specs', 'archive.generated.md');
const INDEX_JSON = join(ROOT, 'specs', 'index.generated.json');

const GENERATED_NOTICE = '<!-- GENERATED FILE — do not edit. Run: node tools/specs.mjs generate -->\n\n';

// ── YAML subset parser ─────────────────────────────────────────────────────

function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;

  function indent(line) { return line.match(/^(\s*)/)[1].length; }

  function parseScalar(s) {
    s = s.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
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

function loadChange(slug, baseDir = ACTIVE_DIR) {
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
  const lines = readFileSync(change._file, 'utf8').split(/\r?\n/);
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

function isTaskReady(task, change) {
  if (!READY_STATUSES.has(task.status)) return false;
  const deps = task.depends_on || [];
  for (const depId of deps) {
    const dep = change.tasks.find(t => t.id === depId);
    if (!dep || !TERMINAL_STATUSES.has(dep.status)) return false;
  }
  return true;
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

    // Simple cycle detection
    for (const task of change.tasks) {
      const visited = new Set();
      const stack = [task.id];
      while (stack.length) {
        const cur = stack.pop();
        if (visited.has(cur)) { errors.push(`${change._file}: dependency cycle involving '${cur}'`); break; }
        visited.add(cur);
        const t = change.tasks.find(t => t.id === cur);
        for (const d of t?.depends_on || []) stack.push(d);
      }
    }
  }
  return errors;
}

// ── CLI ────────────────────────────────────────────────────────────────────

const [,, cmd, changeSlug, taskId] = process.argv;

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
    if (!isTaskReady(task, change)) {
      console.error(`Task '${taskId}' is not ready (status: ${task.status}, deps not satisfied)`);
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

    // Update task status to in-implementation
    change._pendingUpdates = [{ id: taskId, status: 'in-implementation' }];
    saveChange(change);
    console.log(`Task '${taskId}' set to in-implementation.`);
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
      '  start <change> <task>     Create branch, set task in-implementation',
      '  complete <change> <task>  Mark task as implemented',
      '  verify <change> <task>    Mark task as verified',
      '  archive <change>          Move change to specs/archive/',
    ].join('\n'));
    process.exit(1);
}
