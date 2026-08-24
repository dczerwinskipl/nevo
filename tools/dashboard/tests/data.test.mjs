import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractOverviewSummary,
  loadDashboardData,
  loadSpecificationDocument,
  loadSpecificationManifest,
  loadTaskStatuses,
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
    assert.equal(data.active[0].specId, null);
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

test('carries a manifest\'s spec_id through both the dashboard projection and the specification manifest payload (D2)', async () => {
  const sample = fixture();
  try {
    const activeChange = join(sample.activeDir, 'sample-change');
    writeFileSync(join(activeChange, 'change.yaml'), `id: sample-change\nspec_id: 4c1a7b8e-2f3d-4a5b-9c6d-1e2f3a4b5c6d\ntitle: Sample change\nstatus: in-implementation\npriority: 1\ntasks:\n  - id: design-it\n    order: 1\n    file: tasks/01-design-it.md\n    status: verified\n`);

    const change = loadDashboardData({ ...sample, repoRoot: sample.root }).active[0];
    assert.equal(change.specId, '4c1a7b8e-2f3d-4a5b-9c6d-1e2f3a4b5c6d');

    const manifest = await loadSpecificationManifest({ source: 'active', slug: 'sample-change', ...sample, repoRoot: sample.root });
    assert.equal(manifest.specId, '4c1a7b8e-2f3d-4a5b-9c6d-1e2f3a4b5c6d');
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

test('manifest lists documents (no bodies) with canonical titles, deterministic areas, and manifest-ordered tasks', async () => {
  const sample = fixture();
  try {
    const manifest = await loadSpecificationManifest({
      source: 'active',
      slug: 'sample-change',
      ...sample,
      repoRoot: sample.root,
    });

    assert.equal(manifest.overview.title, 'Sample change');
    assert.equal(manifest.overview.available, true);
    assert.equal(manifest.overview.docId, 'overview');
    assert.equal(manifest.overview.markdown, undefined);
    assert.deepEqual(manifest.areas.map(area => area.id), ['01-contract', '02-runtime']);
    assert.deepEqual(manifest.areas.map(area => area.title), ['Area: Contract', 'Area: Runtime']);
    assert.deepEqual(manifest.areas.map(area => area.docId), ['area:01-contract', 'area:02-runtime']);
    assert.deepEqual(manifest.tasks.map(task => task.id), ['design-it', 'build-it']);
    assert.equal(manifest.tasks[0].title, 'Design it');
    assert.equal(manifest.tasks[0].docId, 'task:design-it');
    assert.equal(manifest.tasks[0].path, 'specs/active/sample-change/tasks/01-design-it.md');
  } finally {
    sample.cleanup();
  }
});

test('manifest does not read every document\'s full body to recompute titles on a repeat request', async () => {
  const sample = fixture();
  try {
    const before = await loadSpecificationManifest({ source: 'active', slug: 'sample-change', ...sample, repoRoot: sample.root });
    const after = await loadSpecificationManifest({ source: 'active', slug: 'sample-change', ...sample, repoRoot: sample.root });
    assert.deepEqual(before.tasks.map(t => t.title), after.tasks.map(t => t.title));
    assert.equal(before.overview.markdown, undefined);
  } finally {
    sample.cleanup();
  }
});

test('per-document fetch returns exactly one document\'s canonical body', async () => {
  const sample = fixture();
  try {
    const overview = await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'overview', ...sample, repoRoot: sample.root });
    assert.equal(overview.available, true);
    assert.ok(!overview.markdown.startsWith('---'));

    const task = await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'task:design-it', ...sample, repoRoot: sample.root });
    assert.equal(task.title, 'Design it');
    assert.equal(task.markdown, '# Task: Design it\n\nCanonical design body.');
    assert.equal(task.path, 'specs/active/sample-change/tasks/01-design-it.md');
    assert.equal(task.status, 'verified');

    const area = await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'area:01-contract', ...sample, repoRoot: sample.root });
    assert.equal(area.title, 'Area: Contract');

    // A task id is data-driven (change.yaml's own task list) — an unknown one has no
    // file to resolve to, so the document itself doesn't exist (null, like an unknown
    // docId shape entirely). An area id has no such registry beyond the files.mjs
    // themselves — "unknown" is indistinguishable from "an area that lost its file",
    // so it resolves the same way overview does when its file is missing: available: false.
    assert.equal(await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'task:unknown-task', ...sample, repoRoot: sample.root }), null);
    const unknownArea = await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'area:unknown-area', ...sample, repoRoot: sample.root });
    assert.equal(unknownArea.available, false);
    assert.equal(unknownArea.markdown, '');
  } finally {
    sample.cleanup();
  }
});

test('manifest and per-document fetch return explicit optional-document empty states and reject unsafe lookups', async () => {
  const sample = fixture();
  try {
    rmSync(join(sample.archiveDir, 'old-change', 'overview.md'));
    const manifest = await loadSpecificationManifest({
      source: 'archive',
      slug: 'old-change',
      ...sample,
      repoRoot: sample.root,
    });

    assert.equal(manifest.overview.available, false);
    assert.deepEqual(manifest.areas, []);
    assert.deepEqual(manifest.tasks, []);

    const missingOverview = await loadSpecificationDocument({ source: 'archive', slug: 'old-change', docId: 'overview', ...sample, repoRoot: sample.root });
    assert.equal(missingOverview.available, false);
    assert.equal(missingOverview.markdown, '');

    assert.equal(await loadSpecificationManifest({ source: 'other', slug: 'old-change', ...sample }), null);
    assert.equal(await loadSpecificationManifest({ source: 'active', slug: '../old-change', ...sample }), null);
    assert.equal(await loadSpecificationManifest({ source: 'active', slug: 'missing', ...sample }), null);
    assert.equal(await loadSpecificationDocument({ source: 'active', slug: '../old-change', docId: 'overview', ...sample }), null);
    assert.equal(await loadSpecificationDocument({ source: 'active', slug: 'sample-change', docId: 'area:../secret', ...sample }), null);
  } finally {
    sample.cleanup();
  }
});

test('task statuses are small, ordered, and derived only from change.yaml (no per-task file read)', () => {
  const sample = fixture();
  try {
    const statuses = loadTaskStatuses({ source: 'active', slug: 'sample-change', ...sample });
    assert.deepEqual(statuses.tasks.map(t => t.id), ['design-it', 'build-it']);
    assert.equal(statuses.tasks[0].status, 'verified');
    assert.equal(statuses.tasks[1].status, 'approved');
    assert.equal(statuses.tasks[1].ready, true);
    assert.equal(typeof statuses.revision, 'string');
    assert.ok(statuses.revision.length > 0);

    const again = loadTaskStatuses({ source: 'active', slug: 'sample-change', ...sample });
    assert.equal(again.revision, statuses.revision);

    assert.equal(loadTaskStatuses({ source: 'active', slug: 'missing', ...sample }), null);
  } finally {
    sample.cleanup();
  }
});

test('task statuses revision changes when a task\'s status changes', () => {
  const sample = fixture();
  try {
    const before = loadTaskStatuses({ source: 'active', slug: 'sample-change', ...sample });
    const activeChange = join(sample.activeDir, 'sample-change');
    writeFileSync(join(activeChange, 'change.yaml'), `id: sample-change\ntitle: Sample change\nstatus: in-implementation\npriority: 1\ntasks:\n  - id: design-it\n    order: 1\n    file: tasks/01-design-it.md\n    status: verified\n  - id: build-it\n    order: 2\n    file: tasks/02-build-it.md\n    status: in-implementation\n    depends_on: [design-it]\n`);
    const after = loadTaskStatuses({ source: 'active', slug: 'sample-change', ...sample });
    assert.notEqual(after.revision, before.revision);
  } finally {
    sample.cleanup();
  }
});

test('front matter stripping leaves ordinary Markdown untouched', () => {
  assert.equal(stripFrontMatter('---\nid: one\n---\n# Heading\n'), '# Heading\n');
  assert.equal(stripFrontMatter('# Heading\n'), '# Heading\n');
});

test('manifest and document loading support declarative configurable sections (reviews, solution-options, decisions)', async () => {
  const sample = fixture();
  try {
    const activeChange = join(sample.activeDir, 'sample-change');
    mkdirSync(join(activeChange, 'reviews'), { recursive: true });
    writeFileSync(join(activeChange, 'solution-options.md'), '# Solution Options\n\nOption A vs Option B.\n');
    writeFileSync(join(activeChange, 'owner-decisions.md'), '# Decisions\n\nAccepted Option A.\n');
    writeFileSync(join(activeChange, 'reviews', 'spec.md'), '# Review: Spec\n\nLGTM.\n');

    const manifest = await loadSpecificationManifest({
      source: 'active',
      slug: 'sample-change',
      ...sample,
      repoRoot: sample.root,
    });

    assert.ok(Array.isArray(manifest.sections));
    const sectionIds = manifest.sections.map(s => s.id);
    assert.deepEqual(sectionIds, ['specification', 'areas', 'solution-options', 'decisions', 'reviews']);

    const solutionSec = manifest.sections.find(s => s.id === 'solution-options');
    assert.equal(solutionSec.available, true);
    assert.equal(solutionSec.document.title, 'Solution Options');
    assert.equal(solutionSec.document.docId, 'solution-options');

    const decisionsSec = manifest.sections.find(s => s.id === 'decisions');
    assert.equal(decisionsSec.available, true);
    assert.equal(decisionsSec.document.title, 'Decisions');
    assert.equal(decisionsSec.document.docId, 'decisions');

    const reviewsSec = manifest.sections.find(s => s.id === 'reviews');
    assert.equal(reviewsSec.available, true);
    assert.equal(reviewsSec.documents.length, 1);
    assert.equal(reviewsSec.documents[0].id, 'spec');
    assert.equal(reviewsSec.documents[0].docId, 'review:spec');
    assert.equal(reviewsSec.documents[0].title, 'Review: Spec');

    // Fetch individual documents
    const solDoc = await loadSpecificationDocument({
      source: 'active',
      slug: 'sample-change',
      docId: 'solution-options',
      ...sample,
      repoRoot: sample.root,
    });
    assert.equal(solDoc.available, true);
    assert.equal(solDoc.title, 'Solution Options');
    assert.equal(solDoc.markdown, '# Solution Options\n\nOption A vs Option B.');

    const decDoc = await loadSpecificationDocument({
      source: 'active',
      slug: 'sample-change',
      docId: 'decisions',
      ...sample,
      repoRoot: sample.root,
    });
    assert.equal(decDoc.available, true);
    assert.equal(decDoc.title, 'Decisions');
    assert.equal(decDoc.markdown, '# Decisions\n\nAccepted Option A.');

    const revDoc = await loadSpecificationDocument({
      source: 'active',
      slug: 'sample-change',
      docId: 'review:spec',
      ...sample,
      repoRoot: sample.root,
    });
    assert.equal(revDoc.available, true);
    assert.equal(revDoc.title, 'Review: Spec');
    assert.equal(revDoc.markdown, '# Review: Spec\n\nLGTM.');

    // When a spec lacks optional sections, available is false (tab not shown)
    const oldManifest = await loadSpecificationManifest({
      source: 'archive',
      slug: 'old-change',
      ...sample,
      repoRoot: sample.root,
    });
    const oldSolSec = oldManifest.sections.find(s => s.id === 'solution-options');
    assert.equal(oldSolSec.available, false);
    const oldRevSec = oldManifest.sections.find(s => s.id === 'reviews');
    assert.equal(oldRevSec.available, false);
    assert.deepEqual(oldRevSec.documents, []);
  } finally {
    sample.cleanup();
  }
});

test('transparently falls back to alternate directory when change is moved between active and archive', async () => {
  const sample = fixture();
  try {
    // 1. Manifest fallback: requesting active for an archived change returns the manifest with source: 'archive'
    const archivedManifestViaActive = await loadSpecificationManifest({
      source: 'active',
      slug: 'old-change',
      ...sample,
      repoRoot: sample.root,
    });
    assert.ok(archivedManifestViaActive);
    assert.equal(archivedManifestViaActive.slug, 'old-change');
    assert.equal(archivedManifestViaActive.source, 'archive');

    // 2. Document fallback: requesting active for an archived document resolves successfully
    const archivedDocViaActive = await loadSpecificationDocument({
      source: 'active',
      slug: 'old-change',
      docId: 'overview',
      ...sample,
      repoRoot: sample.root,
    });
    assert.ok(archivedDocViaActive);
    assert.equal(archivedDocViaActive.available, true);
    assert.equal(archivedDocViaActive.markdown, '# Old change\n\nAn archived item.');

    // 3. Task statuses fallback: requesting active for archived task statuses resolves successfully
    const archivedStatusesViaActive = loadTaskStatuses({
      source: 'active',
      slug: 'old-change',
      ...sample,
    });
    assert.ok(archivedStatusesViaActive);
    assert.equal(archivedStatusesViaActive.slug, 'old-change');
    assert.equal(archivedStatusesViaActive.source, 'archive');

    // 4. Truly missing change returns null
    assert.equal(await loadSpecificationManifest({ source: 'active', slug: 'non-existent', ...sample }), null);
    assert.equal(await loadSpecificationDocument({ source: 'active', slug: 'non-existent', docId: 'overview', ...sample }), null);
    assert.equal(loadTaskStatuses({ source: 'active', slug: 'non-existent', ...sample }), null);
  } finally {
    sample.cleanup();
  }
});

