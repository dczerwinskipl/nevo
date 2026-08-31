import assert from 'node:assert/strict';
import test from 'node:test';

import { activityLabelFor } from '../ui/features/agent-sessions/turn-work/tool-activity-labels.ts';

// AC1: tier 1 wins when present, even when tier 2 could also produce a label.
test('an explicit structured description wins over a tier-2-derivable label', () => {
  const result = activityLabelFor('Read', { path: 'src/index.ts', description: 'Reading the entry point' });
  assert.deepEqual(result, { label: 'Reading the entry point', tier: 1 });
});

// AC2/AC9: tier 2 fires when tier 1 is absent — Read with a path.
test('Read with a path derives a tier-2 label from the path', () => {
  const result = activityLabelFor('Read', { path: 'src/index.ts' });
  assert.equal(result.tier, 2);
  assert.equal(result.label, 'Reading src/index.ts');
});

// AC2/AC9: tier 2 fires when tier 1 is absent — Bash with a command.
test('Bash with a command derives a tier-2 label from the command', () => {
  const result = activityLabelFor('Bash', { command: 'npm test' });
  assert.equal(result.tier, 2);
  assert.equal(result.label, 'Running: npm test');
});

test('Bash with a long command truncates rather than overflowing the label', () => {
  const longCommand = 'a'.repeat(200);
  const result = activityLabelFor('Bash', { command: longCommand });
  assert.equal(result.tier, 2);
  assert.ok(result.label.length < longCommand.length);
  assert.ok(result.label.endsWith('…'));
});

// AC3/AC9: tier 3 fires — Bash with no usable command (unknown).
test('Bash with no usable command falls back to the generic tier-3 label', () => {
  const result = activityLabelFor('Bash', {});
  assert.deepEqual(result, { label: 'Running command', tier: 3 });
});

// AC3/AC9: tier 3 fires — an unmapped tool with no useful structured input.
test('an unmapped tool with no useful structured input falls back to the generic label, never blank', () => {
  const result = activityLabelFor('SomeUnknownTool', { irrelevant: true });
  assert.deepEqual(result, { label: 'Running command', tier: 3 });
});

test('missing input entirely still resolves to a human label, never undefined/blank', () => {
  const result = activityLabelFor('Bash', undefined);
  assert.equal(result.tier, 3);
  assert.ok(result.label.length > 0);
});

// AC4: no extra LLM call for label generation at any tier — the function is a pure,
// synchronous string derivation, never a Promise/async call.
test('activityLabelFor resolves synchronously, never returning a Promise', () => {
  const result = activityLabelFor('Bash', { command: 'ls' });
  assert.equal(result instanceof Promise, false);
});

test('Write and Edit tools derive tier-2 labels from a path the same way Read does', () => {
  assert.equal(activityLabelFor('Write', { path: 'a.ts' }).label, 'Writing a.ts');
  assert.equal(activityLabelFor('Edit', { path: 'a.ts' }).label, 'Editing a.ts');
});

test('Grep and Glob derive tier-2 labels from their pattern', () => {
  assert.equal(activityLabelFor('Grep', { pattern: 'TODO' }).tier, 2);
  assert.equal(activityLabelFor('Glob', { pattern: '**/*.ts' }).tier, 2);
});
