import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readUtf8, resolveWithinBase } from '../lib/fs.mjs';
import { parseFrontMatterFile } from '../lib/yaml.mjs';
import { parseOwnerDecisions, readIfExists } from './fingerprint.mjs';
import { ROOT, listChanges, ACTIVE_DIR } from './store.mjs';
import { ACTIVE_CHANGE_STATUSES, isTaskReady } from './lifecycle-primitives.mjs';

const ROUTING_INDEX_FILE = join(ROOT, 'docs', 'routing.generated.json');

// ── Context-completeness / routing precedence (D12, area context-and-
// validation-hardening, task 05) ────────────────────────────────────────────

function globPrefix(pattern) {
  return pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '').replace(/\\/g, '/');
}

// Path-glob-only overlap — no content/semantic search, no repository scan:
// true when either pattern's fixed prefix is an ancestor of (or equal to) the other's.
export function pathGlobsOverlap(a, b) {
  const pa = globPrefix(a);
  const pb = globPrefix(b);
  return pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

export function loadRoutingIndex() {
  if (!existsSync(ROUTING_INDEX_FILE)) return null;
  return JSON.parse(readUtf8(ROUTING_INDEX_FILE));
}

// A context_exceptions entry validly suppresses its warning only when: its
// `decision` resolves to a currently active (non-superseded) owner decision,
// and `reason` is a non-empty string.
function isActiveContextException(entry, decisionsMap) {
  if (!entry?.omitted || !entry?.decision || !String(entry?.reason || '').trim()) return false;
  const decision = decisionsMap.get(entry.decision);
  return Boolean(decision && !decision.supersededBy);
}

/**
 * Context-completeness check: diff routing-table suggestions against a task's
 * own declared context.required/optional. Pure: routingIndex is the already-loaded
 * JSON, or null when it hasn't been generated yet.
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

// ── Context packet ─────────────────────────────────────────────────────────

export function buildContextPacket(change, task) {
  const taskFile = task.file ? resolveWithinBase(change._dir, task.file) : null;
  const taskFm = taskFile ? parseFrontMatterFile(taskFile) : {};

  const branchMode = change.branch?.mode || 'per-change';
  const prefix = change.branch?.prefix || 'feature';
  const branch = change.branch?.name || (branchMode === 'per-task'
    ? `${prefix}/${change._slug}/${task.id}`
    : `${prefix}/${change._slug}`);

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
    consequential_paths: consequentialPaths,
    context_exceptions: contextExceptions,
    forbidden_paths: taskFm.forbidden_paths || [],
    branch,
    routingWarnings: computeRoutingWarnings(
      loadRoutingIndex(),
      [...allowedPaths, ...consequentialPaths],
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
