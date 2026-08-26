import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readUtf8 } from '../lib/fs.mjs';
import { requireChange } from './store.mjs';
import {
  loadFollowUps,
  addFollowUp,
  resolveFollowUp,
  FOLLOW_UP_SEVERITIES,
} from './follow-ups.mjs';
import { parseOwnerDecisions } from './fingerprint.mjs';
import { CliError } from '../lib/cli-errors.mjs';

export function handleFollowUpAdd(changeSlug, id, options = {}) {
  const change = requireChange(changeSlug);
  if (!options.sourceTask || !options.kind || !options.severity || !options.reason) {
    throw new CliError('follow-up-add requires --source-task, --kind, --severity, and --reason.');
  }
  if (!FOLLOW_UP_SEVERITIES.has(options.severity)) {
    throw new CliError(`--severity must be one of ${[...FOLLOW_UP_SEVERITIES].join('/')}, got '${options.severity}'.`);
  }
  const existing = loadFollowUps(change).follow_ups || [];
  if (existing.some(f => f.id === id)) throw new CliError(`Follow-up '${id}' already exists in change '${changeSlug}'.`);

  addFollowUp(change, {
    id, source_task: options.sourceTask, kind: options.kind, severity: options.severity,
    reason: options.reason, resolver_task: options.resolverTask || null, status: 'open', resolution: null,
  });
  console.log(`Follow-up '${id}' recorded (status: open).`);
}

export function handleFollowUpResolve(changeSlug, id, options = {}) {
  const change = requireChange(changeSlug);
  const entry = (loadFollowUps(change).follow_ups || []).find(f => f.id === id);
  if (!entry) throw new CliError(`Follow-up '${id}' not found in change '${changeSlug}'.`);
  if (!options.resolution) throw new CliError('follow-up-resolve requires --resolution.');

  const status = options.dismiss ? 'dismissed' : 'resolved';
  if (status === 'dismissed' && entry.severity === 'blocking') {
    if (!options.decisionRef) {
      throw new CliError(
        `Dismissing blocking follow-up '${id}' requires --decision-ref citing a recorded owner decision (e.g. --decision-ref D12).`
      );
    }
    const decisionsMap = parseOwnerDecisions(
      existsSync(join(change._dir, 'owner-decisions.md')) ? readUtf8(join(change._dir, 'owner-decisions.md')) : ''
    );
    const decision = decisionsMap.get(options.decisionRef);
    if (!decision) {
      throw new CliError(`--decision-ref '${options.decisionRef}' does not resolve in owner-decisions.md.`);
    }
    if (decision.supersededBy) {
      throw new CliError(`--decision-ref '${options.decisionRef}' is superseded — cite '${decision.supersededBy}' instead.`);
    }
  }

  resolveFollowUp(change, id, { status, resolution: options.resolution, decisionRef: options.decisionRef || null });
  console.log(`Follow-up '${id}' marked as ${status}.`);
}
