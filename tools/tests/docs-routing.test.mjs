// Tests for the machine-readable routing table (D12, area context-and-
// validation-hardening, task 05) — tools/docs.mjs's parse/validate/build/
// check functions for docs/ai/task-routing.md and docs/ai/change-impact-map.md's
// `## Routing table` sections and the docs/routing.generated.json they produce.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseRoutingTable, validateRoutingTables, buildRoutingIndex, checkRoutingIndex,
} from '../docs.mjs';

const validTable = (heading = '## Routing table') => `# A file

Some prose.

${heading}

Explanatory paragraph.

| rule_id | path_glob | doc_ref |
|---|---|---|
| RT-01 | src/NEvo.Core/** | docs/development/architecture-overview.md |
| RT-02 | src/NEvo.Web/** | docs/development/transport-development.md |
`;

describe('parseRoutingTable', () => {
  test('parses a well-formed table into rows', () => {
    const { rules, errors } = parseRoutingTable(validTable(), 'a.md');
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0], {
      rule_id: 'RT-01', path_glob: 'src/NEvo.Core/**',
      doc_ref: 'docs/development/architecture-overview.md', source: 'a.md',
    });
  });

  test('errors when the heading is missing entirely', () => {
    const { rules, errors } = parseRoutingTable('# A file\n\nNo routing section here.\n', 'a.md');
    assert.deepEqual(rules, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /missing '## Routing table' section/);
  });

  test('errors when the heading has no table before the next heading', () => {
    const content = '# A file\n\n## Routing table\n\nJust prose, no table.\n\n## Next section\n\n| x | y |\n|---|---|\n| 1 | 2 |\n';
    const { rules, errors } = parseRoutingTable(content, 'a.md');
    assert.deepEqual(rules, []);
    assert.match(errors[0], /no table before the next heading/);
  });

  test('errors when the header row has the wrong columns', () => {
    const content = '## Routing table\n\n| foo | bar | baz |\n|---|---|---|\n| a | b | c |\n';
    const { rules, errors } = parseRoutingTable(content, 'a.md');
    assert.deepEqual(rules, []);
    assert.match(errors[0], /header must be exactly 'rule_id \| path_glob \| doc_ref'/);
  });

  test('errors on a malformed row (wrong cell count or an empty cell), but keeps parsing subsequent rows', () => {
    const content = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n' +
      '| RT-01 | src/A/** |\n' + // missing third cell
      '| RT-02 |  | docs/x.md |\n' + // empty path_glob
      '| RT-03 | src/B/** | docs/y.md |\n'; // well-formed
    const { rules, errors } = parseRoutingTable(content, 'a.md');
    assert.equal(errors.length, 2);
    assert.match(errors[0], /malformed routing table row/);
    assert.match(errors[1], /malformed routing table row/);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].rule_id, 'RT-03');
  });

  test('table parsing stops at the first non-table line after the header', () => {
    const content = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n' +
      '| RT-01 | src/A/** | docs/development/architecture-overview.md |\n' +
      '\nSome trailing prose, not part of the table.\n';
    const { rules, errors } = parseRoutingTable(content, 'a.md');
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 1);
  });
});

describe('validateRoutingTables', () => {
  test('accepts well-formed, cross-file-unique rules whose doc_ref files exist', () => {
    const sources = [
      { file: 'a.md', content: validTable() },
      { file: 'b.md', content: '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| CIM-01 | src/NEvo.Messaging/** | docs/development/messaging-pipeline.md |\n' },
    ];
    const { rules, errors } = validateRoutingTables(sources);
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 3);
  });

  test('rejects a duplicate rule_id across two different source files', () => {
    const dup = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| RT-01 | src/NEvo.Web/** | docs/development/transport-development.md |\n';
    const sources = [
      { file: 'a.md', content: validTable() }, // already has RT-01
      { file: 'b.md', content: dup },
    ];
    const { errors } = validateRoutingTables(sources);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /duplicate rule_id 'RT-01'/);
    assert.match(errors[0], /also in a\.md/);
  });

  test('rejects a rule_id duplicated within a single file too', () => {
    const content = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n' +
      '| RT-01 | src/A/** | docs/development/architecture-overview.md |\n' +
      '| RT-01 | src/B/** | docs/development/architecture-overview.md |\n';
    const { errors } = validateRoutingTables([{ file: 'a.md', content }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /duplicate rule_id 'RT-01'/);
  });

  test('rejects a rule whose doc_ref does not resolve to a real file', () => {
    const content = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n' +
      '| RT-01 | src/A/** | docs/does/not/exist.md |\n';
    const { errors } = validateRoutingTables([{ file: 'a.md', content }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /references missing doc_ref 'docs\/does\/not\/exist\.md'/);
  });

  test('propagates malformed-row errors from parseRoutingTable unchanged', () => {
    const content = '## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| RT-01 | src/A/** |\n';
    const { errors } = validateRoutingTables([{ file: 'a.md', content }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /malformed routing table row/);
  });
});

describe('buildRoutingIndex', () => {
  test('sorts rules by rule_id and drops nothing but the shape stays stable', () => {
    const rules = [
      { rule_id: 'RT-02', path_glob: 'src/B/**', doc_ref: 'docs/b.md', source: 'a.md' },
      { rule_id: 'RT-01', path_glob: 'src/A/**', doc_ref: 'docs/a.md', source: 'a.md' },
    ];
    const built = buildRoutingIndex(rules);
    assert.deepEqual(built.rules.map(r => r.rule_id), ['RT-01', 'RT-02']);
  });
});

describe('checkRoutingIndex', () => {
  let dir;

  test('reports missing when the index file does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'nevo-routing-'));
    const indexFile = join(dir, 'routing.generated.json');
    const problems = checkRoutingIndex({ rules: [] }, indexFile);
    assert.deepEqual(problems, ['missing: docs/routing.generated.json']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('reports stale when the on-disk rules differ from the freshly-built ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'nevo-routing-'));
    const indexFile = join(dir, 'routing.generated.json');
    writeFileSync(indexFile, JSON.stringify({ generated: 'x', rules: [{ rule_id: 'RT-01' }] }));
    const problems = checkRoutingIndex({ rules: [{ rule_id: 'RT-02' }] }, indexFile);
    assert.deepEqual(problems, ['stale: docs/routing.generated.json']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('reports nothing when the on-disk rules match the freshly-built ones (timestamp ignored)', () => {
    dir = mkdtempSync(join(tmpdir(), 'nevo-routing-'));
    const indexFile = join(dir, 'routing.generated.json');
    const rules = [{ rule_id: 'RT-01', path_glob: 'src/A/**', doc_ref: 'docs/a.md', source: 'a.md' }];
    writeFileSync(indexFile, JSON.stringify({ generated: '2020-01-01T00:00:00.000Z', rules }));
    const problems = checkRoutingIndex({ rules }, indexFile);
    assert.deepEqual(problems, []);
    rmSync(dir, { recursive: true, force: true });
  });
});
