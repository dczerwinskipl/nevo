import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDocGroups, computeVisibleTabs } from '../ui/features/specifications/detail/documentation-projection.ts';

function baseManifest(overrides = {}) {
  return {
    id: 'spec.demo',
    specId: 'demo',
    slug: 'demo',
    title: 'Demo',
    source: 'active',
    path: 'specs/active/demo',
    overview: {
      id: 'overview',
      docId: 'overview',
      kind: 'overview',
      title: 'Overview',
      path: 'overview.md',
      available: false,
      lastModified: null,
    },
    areas: [],
    tasks: [],
    sections: [],
    ...overrides,
  };
}

test('buildDocGroups returns nothing for a null/undefined manifest', () => {
  assert.deepEqual(buildDocGroups(null), []);
  assert.deepEqual(buildDocGroups(undefined), []);
});

test('buildDocGroups projects section-based manifests into groups (document + directory sections)', () => {
  const manifest = baseManifest({
    sections: [
      {
        id: 'specification',
        type: 'document',
        label: 'Specyfikacja',
        icon: 'BookOpenText',
        available: true,
        document: {
          id: 'overview',
          docId: 'overview',
          kind: 'overview',
          title: 'Specyfikacja',
          path: 'overview.md',
          available: true,
          lastModified: null,
        },
      },
      {
        id: 'areas',
        type: 'directory',
        label: 'Obszary',
        icon: 'Boxes',
        available: true,
        documents: [
          {
            id: 'area-1',
            docId: 'area:area-1',
            kind: 'area',
            title: 'Area One',
            path: 'areas/area-1.md',
            available: true,
            lastModified: null,
          },
        ],
      },
      // unavailable sections are skipped entirely
      { id: 'skipped', type: 'document', label: 'Skipped', available: false, document: null },
    ],
  });

  const groups = buildDocGroups(manifest);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    id: 'specification',
    label: 'Specyfikacja',
    icon: 'BookOpenText',
    items: [
      {
        id: 'overview',
        docId: 'overview',
        title: 'Specyfikacja',
        path: 'overview.md',
        sectionId: 'specification',
        sectionLabel: 'Specyfikacja',
        icon: 'BookOpenText',
      },
    ],
  });
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[1].items[0].docId, 'area:area-1');
});

test('buildDocGroups falls back to overview/areas projection when no sections are present', () => {
  const manifest = baseManifest({
    overview: {
      id: 'overview',
      docId: 'overview',
      kind: 'overview',
      title: 'Overview',
      path: 'overview.md',
      available: true,
      lastModified: null,
    },
    areas: [
      {
        id: 'area-1',
        docId: 'area:area-1',
        kind: 'area',
        title: 'Area One',
        path: 'areas/area-1.md',
        available: true,
        lastModified: null,
      },
    ],
  });

  const groups = buildDocGroups(manifest);
  assert.deepEqual(
    groups.map((g) => g.id),
    ['specification', 'areas'],
  );
  assert.equal(groups[0].items[0].docId, 'overview');
  assert.equal(groups[1].items[0].docId, 'area:area-1');
});

test('buildDocGroups omits the fallback overview group when unavailable', () => {
  const manifest = baseManifest();
  assert.deepEqual(buildDocGroups(manifest), []);
});

test('computeVisibleTabs always includes overview and changes', () => {
  const tabs = computeVisibleTabs(baseManifest());
  assert.deepEqual(
    tabs.map((t) => t.id),
    ['overview', 'changes'],
  );
});

test('computeVisibleTabs includes docs when the manifest has any documentation', () => {
  const withAreas = computeVisibleTabs(
    baseManifest({
      areas: [
        {
          id: 'area-1',
          docId: 'area:area-1',
          kind: 'area',
          title: 'Area One',
          path: 'areas/area-1.md',
          available: true,
          lastModified: null,
        },
      ],
    }),
  );
  assert.deepEqual(
    withAreas.map((t) => t.id),
    ['overview', 'docs', 'changes'],
  );

  const withOverview = computeVisibleTabs(
    baseManifest({
      overview: {
        id: 'overview',
        docId: 'overview',
        kind: 'overview',
        title: 'Overview',
        path: 'overview.md',
        available: true,
        lastModified: null,
      },
    }),
  );
  assert.deepEqual(
    withOverview.map((t) => t.id),
    ['overview', 'docs', 'changes'],
  );

  const withSections = computeVisibleTabs(
    baseManifest({
      sections: [
        {
          id: 's',
          type: 'document',
          label: 'S',
          available: true,
          document: {
            id: 's',
            docId: 's',
            kind: 'overview',
            title: 'S',
            path: null,
            available: true,
            lastModified: null,
          },
        },
      ],
    }),
  );
  assert.deepEqual(
    withSections.map((t) => t.id),
    ['overview', 'docs', 'changes'],
  );
});

test('computeVisibleTabs hides docs when sections are present but none are available', () => {
  const manifest = baseManifest({
    sections: [
      { id: 's1', type: 'document', label: 'S1', available: false, document: null },
      { id: 's2', type: 'directory', label: 'S2', available: false, documents: [] },
    ],
  });
  const tabs = computeVisibleTabs(manifest);
  assert.deepEqual(
    tabs.map((t) => t.id),
    ['overview', 'changes'],
  );
});

test('computeVisibleTabs handles a missing manifest (loading state) as docs-less', () => {
  assert.deepEqual(
    computeVisibleTabs(null).map((t) => t.id),
    ['overview', 'changes'],
  );
  assert.deepEqual(
    computeVisibleTabs(undefined).map((t) => t.id),
    ['overview', 'changes'],
  );
});
