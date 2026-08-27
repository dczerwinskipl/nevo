import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeUtf8 } from '../lib/fs.mjs';
import { parseYamlFile, updateYamlFile } from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';

// ── Follow-up ledger — mutable YAML, not append-only (D15, D22, task 06) ───

export const FOLLOW_UP_STATUSES = new Set(['open', 'resolved', 'dismissed']);
export const FOLLOW_UP_SEVERITIES = new Set(['blocking', 'non-blocking']);

export function followUpsFile(change) {
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
    if (decisionRef) item.set('decision_ref', decisionRef);
  });
}
