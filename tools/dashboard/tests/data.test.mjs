import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractOverviewSummary,
  loadDashboardData,
  loadSpecificationContent,
  safeChildPath,
  stripFrontMatter,
} from '../server/data.mjs';

function fixture() {
  const root = join(tmpdir(), `nevo-dashboard-${process.pid}-${Date.now()}`);
  const activeDir = join(root, 'specs', 'active');
  const archiveDir = join(root, 'specs', 'archive');
  const activeChange = join(activeDir, 'sample-change');
  const archivedChange = join(archiveDir, 'old-change');
  mkdirSync(join(activeChange, 'tasks'), { recursive: true });
  mkdirSync(join(activeChange, 'areas'), { recursive: true });
  mkdirSync(join(archivedChange, 'tasks'), { recursive: true });

  writeFileSync(join(activeChange, 'change.yaml'), `id: sample-change\ntitle: Sample change\nstatus: in-implementation\npriority: 1\ntasks:\n  - id: design-it\n    order: 1\n    file: tasks/01-design-it.md\n    status: verified\n  - id: build-it\n    order: 2\n    file: tasks/02-build-it.md\n    status: approved\n    depends_on: [design-it]\n`);
  writeFileSync(join(activeChange, 'overview.md'), '# Sample change\n\n## Context\n\nA **short** file-backed summary for the dashboard.\n');
  writeFileSync(join(activeChange, 'areas', '02-runtime.md'), '# Area: Runtime\n\nRuntime details.\n');
  writeFileSync(join(activeChange, 'areas', '01-contract.md'), '# Area: Contract\n\n| Name | Value |\n| --- | --- |\n| mode | local |\n');
  writeFileSync(join(activeChange, 'tasks', '01-design-it.md'), '---\nid: sample.design\n---\n\n# Task: Design it\n\nCanonical design body.\n');
  writeFileSync(join(activeChange, 'tasks', '02-build-it.md'), '# Task: Build it\n\nCanonical build body.\n');

  writeFileSync(join(archivedChange, 'change.yaml'), 'id: old-change\ntitle: Old change\nstatus: draft\ntasks: []\n');
  writeFileSync(join(archivedChange, 'overview.md'), '# Old change\n\nAn archived item.\n');

  return { root, activeDir, archiveDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('projects active and archived manifests into dashboard data', () => {
  const sample = fixture();
  try {
    const data = loadDashboardData({ ...sample, repoRoot: sample.root });
    assert.deepEqual(data.counts, { active: 1, archived: 1 });
    assert.equal(data.active[0].summary, 'A short file-backed summary for the dashboard.');
    assert.equal(data.active[0].metrics.progress, 50);
    assert.deepEqual(data.active[0].metrics.stageCounts, {
      new: 0,
      design: 0,
      ready: 1,
      implementation: 0,
      review: 0,
      done: 1,
    });
    assert.equal(data.active[0].nextTask.id, 'build-it');
    assert.equal(data.active[0].nextTask.ready, true);
    assert.equal(data.active[0].tasks[1].file, 'specs/active/sample-change/tasks/02-build-it.md');
    assert.equal(data.archive[0].source, 'archive');
    assert.equal(data.archive[0].status, 'archived');
  } finally {
    sample.cleanup();
  }
});

test('summary extraction has deterministic fallbacks', () => {
  assert.equal(extractOverviewSummary('', 'Missing overview'), 'Specification: Missing overview');
  assert.equal(
    extractOverviewSummary('# Heading\n\n## Problem\n\nThe first useful paragraph.\n\nAnother paragraph.'),
    'The first useful paragraph.',
  );
});

test('keeps stage progress at zero while every actionable task is new', () => {
  const sample = fixture();
  try {
    const activeChange = join(sample.activeDir, 'sample-change');
    writeFileSync(join(activeChange, 'change.yaml'), `id: sample-change\ntitle: Sample change\nstatus: draft\ntasks:\n  - id: design-it\n    order: 1\n    file: tasks/01-design-it.md\n    status: new\n  - id: build-it\n    order: 2\n    file: tasks/02-build-it.md\n    status: new\n`);

    const change = loadDashboardData({ ...sample, repoRoot: sample.root }).active[0];
    assert.equal(change.metrics.progress, 0);
    assert.equal(change.metrics.stageCounts.new, 2);
  } finally {
    sample.cleanup();
  }
});

test('does not count review or implementation stages as completed progress', () => {
  const sample = fixture();
  try {
    const activeChange = join(sample.activeDir, 'sample-change');
    writeFileSync(join(activeChange, 'change.yaml'), `id: sample-change\ntitle: Sample change\nstatus: in-implementation\ntasks:\n  - id: design-it\n    order: 1\n    file: tasks/01-design-it.md\n    status: implemented\n  - id: build-it\n    order: 2\n    file: tasks/02-build-it.md\n    status: in-implementation\n`);

    const change = loadDashboardData({ ...sample, repoRoot: sample.root }).active[0];
    assert.equal(change.metrics.progress, 0);
    assert.equal(change.metrics.stageCounts.review, 1);
    assert.equal(change.metrics.stageCounts.implementation, 1);
  } finally {
    sample.cleanup();
  }
});

test('safeChildPath rejects traversal outside a change directory', () => {
  const base = join(tmpdir(), 'change');
  assert.equal(safeChildPath(base, '../../secret.md'), null);
  assert.ok(safeChildPath(base, 'tasks/01-safe.md').endsWith(join('change', 'tasks', '01-safe.md')));
});

test('loads canonical overview, deterministic areas, and manifest-ordered task bodies', () => {
  const sample = fixture();
  try {
    const content = loadSpecificationContent({
      source: 'active',
      slug: 'sample-change',
      ...sample,
      repoRoot: sample.root,
    });

    assert.equal(content.overview.title, 'Sample change');
    assert.equal(content.overview.available, true);
    assert.ok(!content.overview.markdown.startsWith('---'));
    assert.deepEqual(content.areas.map(area => area.id), ['01-contract', '02-runtime']);
    assert.deepEqual(content.areas.map(area => area.title), ['Area: Contract', 'Area: Runtime']);
    assert.deepEqual(content.tasks.map(task => task.id), ['design-it', 'build-it']);
    assert.equal(content.tasks[0].title, 'Design it');
    assert.equal(content.tasks[0].markdown, '# Task: Design it\n\nCanonical design body.');
    assert.equal(content.tasks[0].path, 'specs/active/sample-change/tasks/01-design-it.md');
  } finally {
    sample.cleanup();
  }
});

test('returns explicit optional-document empty states and rejects unsafe lookups', () => {
  const sample = fixture();
  try {
    rmSync(join(sample.archiveDir, 'old-change', 'overview.md'));
    const content = loadSpecificationContent({
      source: 'archive',
      slug: 'old-change',
      ...sample,
      repoRoot: sample.root,
    });

    assert.equal(content.overview.available, false);
    assert.equal(content.overview.markdown, '');
    assert.deepEqual(content.areas, []);
    assert.deepEqual(content.tasks, []);
    assert.equal(loadSpecificationContent({ source: 'other', slug: 'old-change', ...sample }), null);
    assert.equal(loadSpecificationContent({ source: 'active', slug: '../old-change', ...sample }), null);
    assert.equal(loadSpecificationContent({ source: 'active', slug: 'missing', ...sample }), null);
  } finally {
    sample.cleanup();
  }
});

test('front matter stripping leaves ordinary Markdown untouched', () => {
  assert.equal(stripFrontMatter('---\nid: one\n---\n# Heading\n'), '# Heading\n');
  assert.equal(stripFrontMatter('# Heading\n'), '# Heading\n');
});
