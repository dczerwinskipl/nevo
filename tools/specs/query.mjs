import {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  listChanges,
  requireChange,
  requireTask,
} from './store.mjs';
import { validateSpecs } from './validation.mjs';
import { getNext, buildContextPacket } from './context.mjs';
import {
  computeChangeFingerprint,
  computeTaskFingerprint,
} from './fingerprint.mjs';
import { isTaskReady } from './lifecycle-primitives.mjs';

export function handleValidate() {
  const errors = validateSpecs();
  if (errors.length) {
    errors.forEach(e => console.error(e));
    process.exitCode = 1;
    return;
  }
  const n = listChanges(ACTIVE_DIR).length + listChanges(ARCHIVE_DIR).length;
  console.log(`Validated ${n} changes — no errors.`);
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
