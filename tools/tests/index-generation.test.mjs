// Tests that generated-index building is deterministic and free of embedded
// timestamps — running build twice with unchanged inputs must produce byte-identical
// content, per the repo-tools refactor's "build vs write" split. Staleness detection
// itself (`check` failing when a generated file is missing/out of date) is covered by
// the CLI smoke tests, which exercise it against the real, currently-clean repo state.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDocsIndexes } from '../docs/service.mjs';
import { buildSpecsIndexes, writeSpecsIndexes, checkSpecsIndexes } from '../specs/indexes.mjs';

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

  // D2, area stable-spec-identity, task 01, AC4 — every projected change
  // carries specId alongside id (id already doubles as the human-facing
  // slug, per overview.md's "conventionally equals the slug" convention;
  // specId is the new, immutable, non-slug-derived identity).
  test('every projected change carries specId (null for a legacy manifest, a UUID once backfilled)', () => {
    const built = buildSpecsIndexes();
    assert.ok(built.changes.length > 0);
    for (const change of built.changes) {
      assert.ok('specId' in change, `change '${change.id}' is missing a specId field`);
      assert.ok(
        change.specId === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(change.specId),
        `change '${change.id}' has a malformed specId: ${change.specId}`
      );
    }
  });
});

describe('specs index projection stability — D4 option (i)', () => {
  test('no projected task across real repository state contains workflow_progress', () => {
    const built = buildSpecsIndexes();
    assert.ok(built.changes.length > 0);
    for (const change of built.changes) {
      for (const task of change.tasks || []) {
        assert.equal('workflow_progress' in task, false, `task '${task.id}' in '${change.id}' contains workflow_progress`);
      }
    }
  });

  test('changing only workflow_progress leaves checkSpecsIndexes clean; changing status marks index stale', () => {
    const root = mkdtempSync(join(tmpdir(), 'nevo-index-proj-'));
    try {
      const activeDir = join(root, 'active');
      const archiveDir = join(root, 'archive');
      const changeDir = join(activeDir, 'change-fixture');
      mkdirSync(join(changeDir, 'tasks'), { recursive: true });
      mkdirSync(archiveDir, { recursive: true });

      const renderManifest = ({ taskStatus = 'in-implementation', workflowProgress = {} } = {}) => [
        'id: change-fixture',
        'title: Fixture Change',
        'status: in-implementation',
        'tasks:',
        '  - id: t1',
        '    order: 1',
        '    file: tasks/01-t1.md',
        `    status: ${taskStatus}`,
        '    depends_on: []',
        '    workflow_progress:',
        `      current_step: ${workflowProgress.current_step ?? 'implementation'}`,
        `      current_attempt: ${workflowProgress.current_attempt ?? 1}`,
        `      state: ${workflowProgress.state ?? 'running'}`,
        '',
      ].join('\n');

      writeFileSync(join(changeDir, 'change.yaml'), renderManifest({
        taskStatus: 'in-implementation',
        workflowProgress: { current_step: 'implementation', current_attempt: 1, state: 'running' },
      }));

      const activeIndexMd = join(root, 'active.generated.md');
      const archiveIndexMd = join(root, 'archive.generated.md');
      const indexJson = join(root, 'index.generated.json');

      const initialBuilt = buildSpecsIndexes({ activeDir, archiveDir });
      assert.equal('workflow_progress' in initialBuilt.changes[0].tasks[0], false);
      assert.equal(initialBuilt.changes[0].tasks[0].id, 't1');
      assert.equal(initialBuilt.changes[0].tasks[0].status, 'in-implementation');
      assert.deepEqual(initialBuilt.changes[0].tasks[0].depends_on, []);

      writeSpecsIndexes(initialBuilt, { activeIndexMd, archiveIndexMd, indexJson });

      // Clean state
      assert.deepEqual(checkSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson }), []);

      // 1. Changing only workflow_progress must leave checkSpecsIndexes clean
      writeFileSync(join(changeDir, 'change.yaml'), renderManifest({
        taskStatus: 'in-implementation',
        workflowProgress: { current_step: 'review', current_attempt: 2, state: 'completed' },
      }));
      assert.deepEqual(checkSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson }), []);

      // 2. Changing task status must mark index stale
      writeFileSync(join(changeDir, 'change.yaml'), renderManifest({
        taskStatus: 'verified',
        workflowProgress: { current_step: 'review', current_attempt: 2, state: 'completed' },
      }));
      assert.deepEqual(
        checkSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd, indexJson }),
        ['stale: specs/index.generated.json']
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

