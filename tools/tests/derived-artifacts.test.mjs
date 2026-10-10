import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  specsIndexes,
  docsIndexes,
  DERIVED_GENERATORS,
  planDerivedSync,
  resolveDerivedOwnedPaths,
  listDerivedOutputs,
  syncDerivedArtifacts,
} from '../specs/derived/registry.mjs';

describe('planDerivedSync — selective planning', () => {
  test('change.yaml triggers specsIndexes only', () => {
    const plan = planDerivedSync(['change.yaml']);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, 'specs-indexes');
  });

  test('specs/active/*/change.yaml triggers specsIndexes only', () => {
    const plan = planDerivedSync(['specs/active/feature-x/change.yaml']);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, 'specs-indexes');
  });

  test('specs/archive/*/change.yaml triggers specsIndexes only', () => {
    const plan = planDerivedSync(['specs/archive/old-feature/change.yaml']);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, 'specs-indexes');
  });

  test('docs/**/*.md triggers docsIndexes only', () => {
    const plan = planDerivedSync(['docs/architecture/overview.md']);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, 'docs-indexes');
  });

  test('unrelated path triggers no generators', () => {
    const plan1 = planDerivedSync(['src/NEvo.Core/Class.cs']);
    assert.equal(plan1.length, 0);

    const plan2 = planDerivedSync(['package.json', 'README.md']);
    assert.equal(plan2.length, 0);
  });

  test('both specs and docs changed triggers both generators', () => {
    const plan = planDerivedSync([
      'specs/active/feature-x/change.yaml',
      'docs/architecture/overview.md',
    ]);
    assert.equal(plan.length, 2);
    assert.ok(plan.some(g => g.id === 'specs-indexes'));
    assert.ok(plan.some(g => g.id === 'docs-indexes'));
  });
});

describe('resolveDerivedOwnedPaths & listDerivedOutputs', () => {
  test('resolveDerivedOwnedPaths returns exact outputs of planned generators only', () => {
    const specsOutputs = resolveDerivedOwnedPaths([specsIndexes]);
    assert.deepEqual(specsOutputs.sort(), [
      'specs/active.generated.md',
      'specs/archive.generated.md',
      'specs/index.generated.json',
    ].sort());

    const docsOutputs = resolveDerivedOwnedPaths([docsIndexes]);
    assert.deepEqual(docsOutputs.sort(), [
      'docs/index.generated.json',
      'docs/index.generated.md',
      'docs/routing.generated.json',
    ].sort());

    const emptyOutputs = resolveDerivedOwnedPaths([]);
    assert.deepEqual(emptyOutputs, []);
  });

  test('listDerivedOutputs returns all registered generator outputs', () => {
    const all = listDerivedOutputs();
    assert.equal(all.length, 6);
    assert.ok(all.includes('specs/index.generated.json'));
    assert.ok(all.includes('specs/active.generated.md'));
    assert.ok(all.includes('specs/archive.generated.md'));
    assert.ok(all.includes('docs/index.generated.json'));
    assert.ok(all.includes('docs/index.generated.md'));
    assert.ok(all.includes('docs/routing.generated.json'));
  });
});

describe('Deterministic generator execution and idempotency', () => {
  let fixtureDir;

  before(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'nevo-derived-fixture-'));

    // Initialize git repository in fixture dir
    execFileSync('git', ['init', fixtureDir]);
    execFileSync('git', ['-C', fixtureDir, 'config', 'user.name', 'Test User']);
    execFileSync('git', ['-C', fixtureDir, 'config', 'user.email', 'test@example.com']);

    // Setup specs
    mkdirSync(join(fixtureDir, 'specs', 'active', 'test-spec'), { recursive: true });
    mkdirSync(join(fixtureDir, 'specs', 'archive'), { recursive: true });
    writeFileSync(
      join(fixtureDir, 'specs', 'active', 'test-spec', 'change.yaml'),
      'id: test-spec\nspec_id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\ntitle: Test Spec\ntype: standard\nstatus: approved\npriority: 1\ncreated: 2026-10-10\nbranch:\n  name: feature/test\ntasks: []\n'
    );

    // Setup docs
    mkdirSync(join(fixtureDir, 'docs', 'architecture'), { recursive: true });
    mkdirSync(join(fixtureDir, 'docs', 'ai'), { recursive: true });
    writeFileSync(
      join(fixtureDir, 'docs', 'architecture', 'overview.md'),
      '---\nid: architecture.overview\ntype: architecture\ntitle: Architecture Overview\nstatus: stable\nscope: core\nread_when:\n  - when onboarding\nsummary: Overview of the architecture.\n---\n# Architecture\n'
    );
    writeFileSync(
      join(fixtureDir, 'docs', 'ai', 'task-routing.md'),
      '# Task routing\n\n## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| RT-01 | src/** | docs/architecture/overview.md |\n'
    );
    writeFileSync(
      join(fixtureDir, 'docs', 'ai', 'change-impact-map.md'),
      '# Change impact map\n\n## Routing table\n\n| rule_id | path_glob | doc_ref |\n|---|---|---|\n| CI-01 | docs/** | docs/architecture/overview.md |\n'
    );
  });

  after(() => {
    if (fixtureDir) {
      try { rmSync(fixtureDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('running sync twice on fixture yields byte-identical outputs and no git diff', () => {
    const ctx = { repoRoot: fixtureDir };

    // First sync run
    const specsRes1 = specsIndexes.sync(ctx);
    const docsRes1 = docsIndexes.sync(ctx);
    assert.equal(specsRes1.written.length, 3);
    assert.equal(docsRes1.written.length, 3);

    // Capture initial outputs
    const read = (relPath) => readFileSync(join(fixtureDir, relPath), 'utf8');

    const specsJson1 = read('specs/index.generated.json');
    const specsActiveMd1 = read('specs/active.generated.md');
    const specsArchiveMd1 = read('specs/archive.generated.md');

    const docsJson1 = read('docs/index.generated.json');
    const docsMd1 = read('docs/index.generated.md');
    const routingJson1 = read('docs/routing.generated.json');

    // Stage all files in git so diff can detect changes
    execFileSync('git', ['-C', fixtureDir, 'add', '.']);
    execFileSync('git', ['-C', fixtureDir, 'commit', '-m', 'Initial generated artifacts']);

    // Second sync run
    const specsRes2 = specsIndexes.sync(ctx);
    const docsRes2 = docsIndexes.sync(ctx);
    assert.equal(specsRes2.written.length, 3);
    assert.equal(docsRes2.written.length, 3);

    const specsJson2 = read('specs/index.generated.json');
    const specsActiveMd2 = read('specs/active.generated.md');
    const specsArchiveMd2 = read('specs/archive.generated.md');

    const docsJson2 = read('docs/index.generated.json');
    const docsMd2 = read('docs/index.generated.md');
    const routingJson2 = read('docs/routing.generated.json');

    // Assert byte-identical contents across runs
    assert.equal(specsJson2, specsJson1);
    assert.equal(specsActiveMd2, specsActiveMd1);
    assert.equal(specsArchiveMd2, specsArchiveMd1);

    assert.equal(docsJson2, docsJson1);
    assert.equal(docsMd2, docsMd1);
    assert.equal(routingJson2, routingJson1);

    // Verify git status is completely clean with 0 diff
    const gitDiff = execFileSync('git', ['-C', fixtureDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    assert.equal(gitDiff, '', `Expected git status to be clean, got:\n${gitDiff}`);

    // Verify check() returns no problems
    const specsProblems = specsIndexes.check(ctx);
    assert.deepEqual(specsProblems, []);

    const docsProblems = docsIndexes.check(ctx);
    assert.deepEqual(docsProblems, []);
  });

  test('syncDerivedArtifacts executes planned generators', () => {
    const result = syncDerivedArtifacts({
      repoRoot: fixtureDir,
      changedPaths: ['change.yaml'],
    });

    assert.equal(result.plan.length, 1);
    assert.equal(result.plan[0].id, 'specs-indexes');
    assert.equal(result.written.length, 3);
  });
});
