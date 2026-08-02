// Tests that generated-index building is deterministic and free of embedded
// timestamps — running build twice with unchanged inputs must produce byte-identical
// content, per the repo-tools refactor's "build vs write" split. Staleness detection
// itself (`check` failing when a generated file is missing/out of date) is covered by
// the CLI smoke tests, which exercise it against the real, currently-clean repo state.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDocsIndexes } from '../docs/service.mjs';
import { buildSpecsIndexes } from '../specs/service.mjs';

describe('buildDocsIndexes — pure and deterministic', () => {
  const docs = [
    {
      file: 'docs/adr/ADR-0002-x.md', id: 'adr.0002-x', type: 'adr', title: 'X', status: 'accepted',
    },
    {
      file: 'docs/architecture/y.md', id: 'architecture.y', type: 'architecture', title: 'Y', status: 'stable',
      scope: ['a', 'b'],
    },
  ];

  test('same input produces byte-identical output across calls', () => {
    const a = buildDocsIndexes(docs);
    const b = buildDocsIndexes(docs);
    assert.deepEqual(a, b);
  });

  test('output contains no embedded timestamp', () => {
    const built = buildDocsIndexes(docs);
    assert.doesNotMatch(built.mdHeader + built.mdBody, /_Generated:/);
    assert.equal('generated' in built, false);
  });

  test('sorts by type order, then id', () => {
    const built = buildDocsIndexes(docs);
    assert.equal(built.sortedDocs[0].type, 'architecture');
    assert.equal(built.sortedDocs[1].type, 'adr');
  });
});

describe('buildSpecsIndexes — pure content is deterministic against real repo state', () => {
  test('same repository state produces byte-identical output across calls', () => {
    const a = buildSpecsIndexes();
    const b = buildSpecsIndexes();
    assert.equal(a.activeMd, b.activeMd);
    assert.equal(a.archiveMd, b.archiveMd);
    assert.deepEqual(a.changes, b.changes);
  });

  test('the Markdown outputs contain no embedded timestamp', () => {
    const built = buildSpecsIndexes();
    assert.doesNotMatch(built.activeMd, /_Generated:/);
    assert.doesNotMatch(built.archiveMd, /_Generated:/);
  });
});
