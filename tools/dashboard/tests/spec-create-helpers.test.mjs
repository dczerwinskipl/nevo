import assert from 'node:assert/strict';
import test from 'node:test';

import { slugifyTitle, generateInitialPrompt, SPEC_TYPES_OPTIONS } from '../src/lib/spec-create-helpers.ts';

test('slugifyTitle converts titles to canonical kebab-case slugs', () => {
  assert.equal(slugifyTitle('Multi-Provider Agent Sessions'), 'multi-provider-agent-sessions');
  assert.equal(slugifyTitle('Zażółć gęślą jaźń'), 'zazolc-gesla-jazn');
  assert.equal(slugifyTitle('  Leading & Trailing Spaces!  '), 'leading-trailing-spaces');
  assert.equal(slugifyTitle('Special@#Characters$$123'), 'special-characters-123');
  assert.equal(slugifyTitle(''), '');
});

test('generateInitialPrompt generates structured template with title, slug, and goal', () => {
  const prompt = generateInitialPrompt('My Great Feature', 'Deliver amazing value', 'my-great-feature');
  assert.ok(prompt.includes("[NEvo Context: Specification 'my-great-feature']"));
  assert.ok(prompt.includes('Title: "My Great Feature"'));
  assert.ok(prompt.includes('Location: specs/active/my-great-feature/'));
  assert.ok(prompt.includes('Deliver amazing value'));
  assert.ok(prompt.includes('Do NOT scaffold a new or duplicate specification'));

  const emptyGoalPrompt = generateInitialPrompt('My Feature', '', 'my-feature');
  assert.ok(emptyGoalPrompt.includes('My Feature'));
  assert.ok(emptyGoalPrompt.includes('Define the goals, constraints, affected areas'));
});

test('SPEC_TYPES_OPTIONS contains standard, architectural, small, exploratory options', () => {
  const ids = SPEC_TYPES_OPTIONS.map(o => o.id);
  assert.deepEqual(ids, ['standard', 'architectural', 'small', 'exploratory']);
});
