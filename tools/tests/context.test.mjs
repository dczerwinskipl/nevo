// Tests for the context-completeness check (D12, area context-and-validation-
// hardening, task 05): tools/specs/service.mjs's computeRoutingWarnings and its
// wiring into buildContextPacket via docs/routing.generated.json. Run: node
// --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeRoutingWarnings, buildContextPacket, loadChange } from '../specs/service.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TASK_ROUTING_FILE = join(ROOT, 'docs', 'ai', 'task-routing.md');

const routingIndex = () => ({
  generated: '2020-01-01T00:00:00.000Z',
  rules: [
    { rule_id: 'RT-01', path_glob: 'src/NEvo.Core/**', doc_ref: 'docs/development/architecture-overview.md', source: 'docs/ai/task-routing.md' },
    { rule_id: 'CIM-02', path_glob: 'src/NEvo.Messaging/**', doc_ref: 'docs/reference/packages/NEvo.Messaging.md', source: 'docs/ai/change-impact-map.md' },
  ],
});

describe('computeRoutingWarnings — the context-completeness check (requirements 2/3/4/6)', () => {
  test('warns that the routing index has not been generated yet, when it is null', () => {
    const warnings = computeRoutingWarnings(null, ['src/NEvo.Core/Foo.cs'], []);
    assert.deepEqual(warnings, [
      'routing index not generated (docs/routing.generated.json) — run `node tools/docs.mjs generate`',
    ]);
  });

  test('warns "no routing rule matched" when no rule overlaps the task\'s allowed_paths (requirement 6)', () => {
    const warnings = computeRoutingWarnings(routingIndex(), ['tools/specs.mjs'], []);
    assert.deepEqual(warnings, ['no routing rule matched — verify context manually']);
  });

  test('reports a gap when a matching rule\'s doc_ref is not in the declared context', () => {
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /RT-01/);
    assert.match(warnings[0], /docs\/development\/architecture-overview\.md/);
  });

  test('reports no gap when the matching rule\'s doc_ref is already declared — declared context always wins (requirement 4)', () => {
    const warnings = computeRoutingWarnings(
      routingIndex(), ['src/NEvo.Core/Foo.cs'], ['docs/development/architecture-overview.md']
    );
    assert.deepEqual(warnings, []);
  });

  test('matches on allowed_paths that are themselves already a glob, not just literal files', () => {
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/**'], []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /RT-01/);
  });

  test('reports one gap per unmatched-but-relevant rule when several allowed_paths match different rules', () => {
    const warnings = computeRoutingWarnings(
      routingIndex(), ['src/NEvo.Core/Foo.cs', 'src/NEvo.Messaging/Bar.cs'], []
    );
    assert.equal(warnings.length, 2);
  });

  test('an unrelated allowed_paths entry alongside a matching one does not suppress the match', () => {
    const warnings = computeRoutingWarnings(
      routingIndex(), ['tools/specs.mjs', 'src/NEvo.Core/Foo.cs'], []
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /RT-01/);
  });

  test('never reports a hard failure shape — always an array of warning strings, even when empty', () => {
    const warnings = computeRoutingWarnings(routingIndex(), [], []);
    assert.ok(Array.isArray(warnings));
  });
});

describe('buildContextPacket\'s routingWarnings — reads only docs/routing.generated.json (AC3)', () => {
  test('the check still works after temporarily corrupting the prose table body, leaving the generated JSON intact', () => {
    const change = loadChange('nevo-ai-process-continuity-and-hardening');
    const task = change.tasks.find(t => t.id === 'context-completeness-and-routing-precedence');
    const before = readFileSync(TASK_ROUTING_FILE, 'utf8');
    const baseline = buildContextPacket(change, task).routingWarnings;

    writeFileSync(TASK_ROUTING_FILE, 'this is not a routing table at all, just corrupted prose\n');
    try {
      const afterCorruption = buildContextPacket(change, task).routingWarnings;
      assert.deepEqual(afterCorruption, baseline, 'routingWarnings must be unaffected by corrupting the prose source');
    } finally {
      writeFileSync(TASK_ROUTING_FILE, before);
    }
  });
});
