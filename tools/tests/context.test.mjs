// Tests for the context-completeness check (D12, area context-and-validation-
// hardening, task 05): tools/specs/service.mjs's computeRoutingWarnings and its
// wiring into buildContextPacket via docs/routing.generated.json. Run: node
// --test tools/tests/
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeRoutingWarnings, buildContextPacket } from '../specs/context.mjs';
import { loadChange, ARCHIVE_DIR } from '../specs/store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

describe('computeRoutingWarnings — context_exceptions suppression (PR review packet 04, Problem 1)', () => {
  const activeDecisions = new Map([['D1', { text: 'D1 text', supersededBy: null }]]);
  const supersededDecisions = new Map([['D1', { text: 'D1 text', supersededBy: 'D2' }], ['D2', { text: 'D2 text', supersededBy: null }]]);

  test('a matching, valid exception (active decision, non-empty reason) suppresses exactly its own warning', () => {
    const exceptions = [{ omitted: 'docs/development/architecture-overview.md', decision: 'D1', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, activeDecisions);
    assert.deepEqual(warnings, []);
  });

  test('an exception for a different document does not suppress an unrelated warning', () => {
    const exceptions = [{ omitted: 'docs/some/other.md', decision: 'D1', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, activeDecisions);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /RT-01/);
  });

  test('an exception whose decision does not resolve does not suppress the warning', () => {
    const exceptions = [{ omitted: 'docs/development/architecture-overview.md', decision: 'D99', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, activeDecisions);
    assert.equal(warnings.length, 1);
  });

  test('an exception citing a superseded decision does not suppress the warning', () => {
    const exceptions = [{ omitted: 'docs/development/architecture-overview.md', decision: 'D1', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, supersededDecisions);
    assert.equal(warnings.length, 1);
  });

  test('an exception with a blank reason does not suppress the warning', () => {
    const exceptions = [{ omitted: 'docs/development/architecture-overview.md', decision: 'D1', reason: '   ' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, activeDecisions);
    assert.equal(warnings.length, 1);
  });

  test('one valid exception does not hide an unrelated, unsuppressed warning', () => {
    const exceptions = [{ omitted: 'docs/development/architecture-overview.md', decision: 'D1', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(
      routingIndex(), ['src/NEvo.Core/Foo.cs', 'src/NEvo.Messaging/Bar.cs'], [], exceptions, activeDecisions
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /CIM-02/);
  });

  test('exact omitted matching only — a substring match does not suppress', () => {
    const exceptions = [{ omitted: 'architecture-overview.md', decision: 'D1', reason: 'not relevant here' }];
    const warnings = computeRoutingWarnings(routingIndex(), ['src/NEvo.Core/Foo.cs'], [], exceptions, activeDecisions);
    assert.equal(warnings.length, 1);
  });
});

describe('buildContextPacket — consequential_paths (PR review packet 04, Problem 2)', () => {
  test('the routing-scope contract: consequential_paths participates in matching alongside allowed_paths', () => {
    const warningsFromAllowedOnly = computeRoutingWarnings(routingIndex(), ['tools/specs.mjs'], []);
    const warningsWithConsequential = computeRoutingWarnings(routingIndex(), ['tools/specs.mjs', 'src/NEvo.Core/**'], []);
    assert.deepEqual(warningsFromAllowedOnly, ['no routing rule matched — verify context manually']);
    assert.equal(warningsWithConsequential.length, 1);
    assert.match(warningsWithConsequential[0], /RT-01/);
  });

  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'nevo-context-test-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  test('buildContextPacket exposes consequential_paths and context_exceptions, kept separate from allowed_paths', () => {
    const slug = 'fixture';
    const dir = join(root, slug);
    mkdirSync(join(dir, 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'change.yaml'), 'id: fixture\ntitle: Fixture\nstatus: draft\ntasks:\n  - id: t1\n    file: tasks/t1.md\n    status: draft\n');
    writeFileSync(join(dir, 'owner-decisions.md'), '## D1: First\n\nText.\n');
    writeFileSync(join(dir, 'tasks', 't1.md'), [
      '---', 'id: fixture.t1',
      'allowed_paths:', '  - a.mjs',
      'consequential_paths:', '  - a.generated.json',
      'context_exceptions:', '  - omitted: docs/x.md', '    decision: D1', '    reason: not relevant',
      '---', '# T1', '',
    ].join('\n'));

    const change = loadChange(slug, root);
    const packet = buildContextPacket(change, change.tasks[0]);
    assert.deepEqual(packet.allowed_paths, ['a.mjs']);
    assert.deepEqual(packet.consequential_paths, ['a.generated.json']);
    assert.deepEqual(packet.context_exceptions, [{ omitted: 'docs/x.md', decision: 'D1', reason: 'not relevant' }]);
  });
});

describe('buildContextPacket\'s routingWarnings — reads only docs/routing.generated.json (AC3)', () => {
  // Non-destructive (PR review packet 05, "Test hygiene"): the previous
  // version of this test temporarily overwrote the real, tracked
  // docs/ai/task-routing.md and restored it in a `finally` — fragile under a
  // parallel test run and leaves the working tree damaged if the process is
  // ever interrupted between the write and the restore. computeRoutingWarnings
  // (exercised directly, with a fabricated in-memory routing index, in the
  // suite above) already fully proves the *computation* never touches the
  // prose. What's left to prove here is the *wiring*: the module responsible
  // for it structurally never references either source Markdown file at all.
  test('the routing-warning code path never references the source Markdown files by name, only the generated JSON', () => {
    const source = readFileSync(join(ROOT, 'tools', 'specs', 'context.mjs'), 'utf8');
    assert.doesNotMatch(source, /task-routing\.md/);
    assert.doesNotMatch(source, /change-impact-map\.md/);
    assert.match(source, /routing\.generated\.json/);
  });

  test('buildContextPacket returns a well-formed routingWarnings array for a real task', () => {
    const change = loadChange('nevo-ai-process-continuity-and-hardening', ARCHIVE_DIR);
    const task = change.tasks.find(t => t.id === 'context-completeness-and-routing-precedence');
    const packet = buildContextPacket(change, task);
    assert.ok(Array.isArray(packet.routingWarnings));
  });
});
