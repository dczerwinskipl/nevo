import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSheetSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/ui/sheet.tsx', import.meta.url)), 'utf8');
}

function readSessionDetailsSource() {
  return readFileSync(fileURLToPath(new URL('../src/components/session-details/session-details.tsx', import.meta.url)), 'utf8');
}

test('Finding 3: Sheet primitive is safe-area aware on mobile while preserving desktop spacing', () => {
  const source = readSheetSource();

  // Container padding includes safe-area insets for mobile
  assert.match(source, /pt-\[max\(1\.25rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(source, /pb-\[max\(1\.25rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source, /pl-\[max\(1\.25rem,env\(safe-area-inset-left\)\)\]/);
  assert.match(source, /pr-\[max\(1\.25rem,env\(safe-area-inset-right\)\)\]/);

  // Close button includes safe-area offset for mobile notches and camera cutouts
  assert.match(source, /top-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(source, /right-\[max\(1rem,env\(safe-area-inset-right\)\)\]/);

  // Desktop breakpoints preserve clean desktop layout
  assert.match(source, /sm:pt-6 sm:pb-6 sm:pl-6 sm:pr-6/);
  assert.match(source, /sm:right-4 sm:top-4/);
});

test('Task 06: SessionDetails component exposes context, tasks, provider, mode, and delete confirmation', () => {
  const source = readSessionDetailsSource();

  // Displays spec title and ID
  assert.match(source, /specTitle/);
  assert.match(source, /specId/);

  // Displays associated tasks
  assert.match(source, /normalizedTasks\.length/);
  assert.match(source, /normalizedTasks\.map/);

  // Displays provider and mode
  assert.match(source, /provider/);
  assert.match(source, /mode/);

  // Destructive delete button
  assert.match(source, /onDelete/);
  assert.match(source, /Usuń sesję/);
});
