import assert from 'node:assert/strict';
import test from 'node:test';

import { slugifyTitle, resolveDefaultPlanningMode, SPEC_TYPES_OPTIONS } from '../src/lib/spec-create-helpers.ts';

test('slugifyTitle converts titles to canonical kebab-case slugs', () => {
  assert.equal(slugifyTitle('Multi-Provider Agent Sessions'), 'multi-provider-agent-sessions');
  assert.equal(slugifyTitle('Zażółć gęślą jaźń'), 'zazolc-gesla-jazn');
  assert.equal(slugifyTitle('  Leading & Trailing Spaces!  '), 'leading-trailing-spaces');
  assert.equal(slugifyTitle('Special@#Characters$$123'), 'special-characters-123');
  assert.equal(slugifyTitle(''), '');
});

test('SPEC_TYPES_OPTIONS contains standard, architectural, small, exploratory options', () => {
  const ids = SPEC_TYPES_OPTIONS.map(o => o.id);
  assert.deepEqual(ids, ['standard', 'architectural', 'small', 'exploratory']);
});

test('resolveDefaultPlanningMode adheres strictly to safety invariant (Task 13 & 15)', () => {
  // 1. Provider supporting ask, edit, agent initializes wizard to 'ask'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['ask', 'edit', 'agent'],
      defaultMode: 'edit',
    }),
    'ask'
  );

  // 2. Provider without ask initializes to its declared default mode
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'edit',
    }),
    'edit'
  );

  // 3. Provider declaring defaultMode: 'agent' without ask never silently escalates to 'agent'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'agent',
    }),
    'edit'
  );

  // 4. Missing/invalid default mode safely falls back to 'edit'
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
    }),
    'edit'
  );
  assert.equal(
    resolveDefaultPlanningMode({
      supportedModes: ['edit', 'agent'],
      defaultMode: 'unknown',
    }),
    'edit'
  );

  // 5. Missing/null provider safely resolves to default supported 'ask'
  assert.equal(resolveDefaultPlanningMode(null), 'ask');
  assert.equal(resolveDefaultPlanningMode(undefined), 'ask');

  // 6. Switching provider re-evaluates deterministically
  const providerA = { supportedModes: ['ask', 'edit', 'agent'], defaultMode: 'edit' };
  const providerB = { supportedModes: ['edit', 'agent'], defaultMode: 'edit' };
  assert.equal(resolveDefaultPlanningMode(providerA), 'ask');
  assert.equal(resolveDefaultPlanningMode(providerB), 'edit');
  assert.equal(resolveDefaultPlanningMode(providerA), 'ask');
});

test('untouched wizard planning flow never escalates to agent; agent requires explicit user selection', () => {
  const providerWithAgent = {
    id: 'claude',
    label: 'Claude',
    supportedModes: ['ask', 'edit', 'agent'],
    defaultMode: 'edit',
  };

  // Untouched state: initial mode is resolved via resolveDefaultPlanningMode
  let activeMode = resolveDefaultPlanningMode(providerWithAgent);
  assert.equal(activeMode, 'ask');
  assert.notEqual(activeMode, 'agent', 'Untouched wizard must never default to agent');

  // User explicitly selects 'agent'
  const handleUserModeClick = (selected) => {
    if (providerWithAgent.supportedModes.includes(selected)) {
      activeMode = selected;
    }
  };

  handleUserModeClick('agent');
  assert.equal(activeMode, 'agent', 'Agent mode becomes active after explicit selection');

  // Switching provider resets according to new provider capabilities
  const providerWithoutAsk = {
    id: 'mock',
    label: 'Mock',
    supportedModes: ['edit', 'agent'],
    defaultMode: 'edit',
  };
  activeMode = resolveDefaultPlanningMode(providerWithoutAsk);
  assert.equal(activeMode, 'edit', 'Switching provider resets to safe non-agent mode');
});
