import { join } from 'node:path';

import {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  listChanges,
  loadChangeAnywhere,
  requireChange,
  requireTask,
  addPullRequestReference,
} from '../store.mjs';
import {
  buildSpecsIndexes,
  writeSpecsIndexes,
  checkSpecsIndexes,
} from '../indexes.mjs';
import { validateSpecs } from '../validation.mjs';
import { getNext, buildContextPacket } from '../context.mjs';
import {
  computeChangeFingerprint,
  computeTaskFingerprint,
} from '../fingerprint.mjs';
import { backfillSpecIds } from '../identity.mjs';
import { archiveSpecificationSync } from '../operations/finalize.mjs';
import { isTaskReady } from '../lifecycle-primitives.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

function reportErrors(errors) {
  errors.forEach(e => console.error(e));
  process.exitCode = 1;
}

export function handleGenerate() {
  const errors = validateSpecs();
  if (errors.length) {
    reportErrors(errors);
    return;
  }
  const built = buildSpecsIndexes();
  writeSpecsIndexes(built);
  console.log(`Generated: specs/active.generated.md (${built.activeCount} changes)`);
  console.log(`Generated: specs/archive.generated.md (${built.archiveCount} changes)`);
  console.log('Generated: specs/index.generated.json');
}

export function handleValidate() {
  const errors = validateSpecs();
  if (errors.length) {
    reportErrors(errors);
    return;
  }
  const n = listChanges(ACTIVE_DIR).length + listChanges(ARCHIVE_DIR).length;
  console.log(`Validated ${n} changes — no errors.`);
}

export function handleCheck() {
  const errors = validateSpecs();
  if (errors.length) {
    reportErrors(errors);
    return;
  }
  const problems = checkSpecsIndexes();
  if (problems.length) {
    problems.forEach(p => console.error(p));
    console.error('Run: node tools/specs.mjs generate');
    process.exitCode = 1;
    return;
  }
  console.log('Specs valid and indexes are current.');
}

export function handleList() {
  const changes = listChanges(ACTIVE_DIR);
  if (!changes.length) {
    console.log('No active changes.');
    return;
  }
  for (const c of changes) {
    console.log(`\n[${c.status}] ${c.id} — ${c.title} (priority: ${c.priority ?? '-'})`);
    for (const t of c.tasks) {
      const ready = isTaskReady(t, c) ? ' ✓' : ' ';
      console.log(`  ${t.order ?? '-'}. [${t.status}] ${t.id}${ready}`);
    }
  }
}

export function handleNext() {
  const packet = getNext();
  if (!packet) {
    console.log('No approved tasks ready.');
    return;
  }
  console.log(JSON.stringify(packet, null, 2));
}

export function handleContext(changeSlug, taskId) {
  const change = requireChange(changeSlug);
  const task = requireTask(change, taskId);
  console.log(JSON.stringify(buildContextPacket(change, task), null, 2));
}

export function handleFingerprint(changeSlug, options = {}) {
  const change = requireChange(changeSlug);
  if (options.task) {
    requireTask(change, options.task);
    console.log(computeTaskFingerprint(change, options.task));
    return;
  }
  console.log(computeChangeFingerprint(change));
}

export function handleArchive(changeSlug) {
  const change = requireChange(changeSlug);
  const changeDir = join(ACTIVE_DIR, changeSlug);
  archiveSpecificationSync(changeSlug, changeDir);
  console.log(`Change '${changeSlug}' archived to specs/archive/.`);
}

export function handlePullRequestAdd(changeSlug, options = {}, directories = {}) {
  const located = loadChangeAnywhere(changeSlug, directories);
  if (!located) throw new CliError(`Change '${changeSlug}' not found in specs/active/ or specs/archive/`);

  const result = addPullRequestReference(located.change, {
    provider: options.provider,
    base_url: options.baseUrl,
    repository: options.repository,
    number: options.number,
  });
  const reference = result.reference;
  const identity = `${reference.provider}:${reference.base_url}/${reference.repository}#${reference.number}`;
  console.log(result.added
    ? `Pull request '${identity}' attached to '${changeSlug}' (${located.location}).`
    : `Pull request '${identity}' is already attached to '${changeSlug}' — no changes made.`);
  return result;
}

export function handleBackfillSpecId() {
  const assigned = backfillSpecIds();
  if (!assigned.length) {
    console.log('All active and archived specifications already have a valid spec_id.');
    return;
  }
  console.log(`Assigned spec_id to ${assigned.length} specification(s):`);
  for (const entry of assigned) {
    console.log(`  - ${entry.slug}: ${entry.specId}`);
  }
  const built = buildSpecsIndexes();
  writeSpecsIndexes(built);
  console.log('Rebuilt generated indexes.');
}
