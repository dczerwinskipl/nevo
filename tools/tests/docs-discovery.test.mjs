// tools/tests/docs-discovery.test.mjs
// Tests for documentation discovery, path routing, read_when validation, and index generation.
// Run: node --test tools/tests/docs-discovery.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanDocs,
  validateDocs,
  buildDocsIndexes,
  findDocs,
  pathMatchesRule,
  REQUIRED_FIELDS,
} from '../docs/service.mjs';

describe('validateDocs read_when enforcement', () => {
  const baseDoc = {
    id: 'development.sample',
    type: 'development',
    title: 'Sample Development Doc',
    status: 'current',
    summary: 'A sample document for testing validation.',
    file: 'docs/development/sample.md',
  };

  test('REQUIRED_FIELDS includes read_when for development and ai', () => {
    assert.ok(REQUIRED_FIELDS.development.includes('read_when'));
    assert.ok(REQUIRED_FIELDS.ai.includes('read_when'));
    assert.ok(REQUIRED_FIELDS.architecture.includes('read_when'));
  });

  test('rejects development doc missing read_when', () => {
    const doc = { ...baseDoc };
    const errors = validateDocs([doc]);
    assert.ok(errors.some(e => e.includes("missing required field 'read_when'")));
  });

  test('rejects ai doc missing read_when', () => {
    const doc = {
      id: 'ai.sample',
      type: 'ai',
      title: 'Sample AI Doc',
      status: 'current',
      summary: 'A sample AI document.',
      file: 'docs/ai/sample.md',
    };
    const errors = validateDocs([doc]);
    assert.ok(errors.some(e => e.includes("missing required field 'read_when'")));
  });

  test('rejects read_when that is not an array', () => {
    const doc = { ...baseDoc, read_when: 'not-an-array' };
    const errors = validateDocs([doc]);
    assert.ok(errors.some(e => e.includes("'read_when' must be a non-empty array of strings")));
  });

  test('rejects empty read_when array', () => {
    const doc = { ...baseDoc, read_when: [] };
    const errors = validateDocs([doc]);
    assert.ok(errors.some(e => e.includes("'read_when' must be a non-empty array of strings")));
  });

  test('rejects read_when with empty string entries', () => {
    const doc = { ...baseDoc, read_when: ['valid entry', '   '] };
    const errors = validateDocs([doc]);
    assert.ok(errors.some(e => e.includes("'read_when' entries must be non-empty strings")));
  });

  test('accepts valid read_when array of non-empty strings', () => {
    const doc = { ...baseDoc, read_when: ['first scenario', 'second scenario'] };
    const errors = validateDocs([doc]);
    assert.deepEqual(errors, []);
  });
});

describe('buildDocsIndexes summary column', () => {
  test('replaces Scopes column with Summary in markdown table', () => {
    const docs = [
      {
        id: 'development.test-comp',
        type: 'development',
        title: 'Test Component Guide',
        status: 'current',
        read_when: ['testing'],
        summary: 'Guide for testing components.',
        file: 'docs/development/test-comp.md',
      },
    ];

    const built = buildDocsIndexes(docs);
    assert.ok(built.mdBody.includes('| ID | Title | Status | Summary |'));
    assert.ok(!built.mdBody.includes('| ID | Title | Status | Scopes |'));
    assert.ok(built.mdBody.includes('| `development.test-comp` | [Test Component Guide](development/test-comp.md) | current | Guide for testing components. |'));
  });

  test('escapes pipe characters and normalizes newlines in summary', () => {
    const docs = [
      {
        id: 'development.multiline',
        type: 'development',
        title: 'Multiline Guide',
        status: 'current',
        read_when: ['testing'],
        summary: 'First line.\nSecond line with | pipe character.',
        file: 'docs/development/multiline.md',
      },
    ];

    const built = buildDocsIndexes(docs);
    assert.ok(built.mdBody.includes('First line. Second line with \\| pipe character.'));
  });
});

describe('pathMatchesRule', () => {
  test('matches exact file paths', () => {
    assert.ok(pathMatchesRule('tools/specs.mjs', 'tools/specs.mjs'));
  });

  test('matches directory glob prefix (**)', () => {
    assert.ok(pathMatchesRule('tools/dashboard/ui/index.css', 'tools/dashboard/ui/**'));
    assert.ok(pathMatchesRule('tools/dashboard/ui/components/ui/button.tsx', 'tools/dashboard/ui/**'));
    assert.ok(pathMatchesRule('tools/dashboard/ui', 'tools/dashboard/ui/**'));
  });

  test('matches single directory glob (*)', () => {
    assert.ok(pathMatchesRule('tools/docs.mjs', 'tools/*.mjs'));
    assert.ok(!pathMatchesRule('tools/dashboard/server/index.mjs', 'tools/*.mjs'));
  });

  test('matches nested pattern with file extension', () => {
    assert.ok(
      pathMatchesRule(
        'tools/dashboard/ui/foundations/colors.stories.tsx',
        'tools/dashboard/ui/**/*.stories.*'
      )
    );
  });

  test('rejects unrelated paths', () => {
    assert.ok(!pathMatchesRule('src/NEvo.Core/Class.cs', 'tools/dashboard/ui/**'));
    assert.ok(!pathMatchesRule('docs/development/readme.md', 'tools/**'));
  });
});

describe('findDocs', () => {
  const sampleDocs = [
    {
      id: 'development.react-component-guidelines',
      type: 'development',
      title: 'React component and module guidelines',
      status: 'current',
      summary: 'Practical architecture guidelines for React UI code: component composition, cva recipes, and tokens.',
      read_when: [
        'creating or restructuring React components',
        'changing styling or status/color presentation',
      ],
      related: ['development.ui-ux-guidelines', 'development.storybook'],
      file: 'docs/development/react-component-guidelines.md',
      scope: 'frontend',
    },
    {
      id: 'development.ui-ux-guidelines',
      type: 'development',
      title: 'UI and UX guidelines',
      status: 'current',
      summary: 'Portable UI/UX rules for information hierarchy, visual weight, semantic color status vocabulary, and state.',
      read_when: [
        'designing or changing frontend UI',
        'designing loading, active, empty, warning, error, or attention states',
      ],
      related: ['development.react-component-guidelines', 'development.nevo-ai-ux-guidelines'],
      file: 'docs/development/ui-ux-guidelines.md',
      scope: 'frontend',
    },
    {
      id: 'development.storybook',
      type: 'development',
      title: 'Storybook guidelines and workflows',
      status: 'current',
      summary: 'Guide to Storybook for the NEvo dashboard: visual verification, stories, fixtures, and foundations.',
      read_when: [
        'creating, editing, or inspecting Storybook stories',
        'verifying UI components visually or running component tests',
      ],
      related: ['development.react-component-guidelines', 'development.ui-ux-guidelines'],
      file: 'docs/development/storybook.md',
      scope: 'frontend',
    },
    {
      id: 'development.node-tooling-guidelines',
      type: 'development',
      title: 'Node tooling and CLI guidelines',
      status: 'current',
      summary: 'Engineering standards for CLI tools, background processes, and tests.',
      read_when: ['writing node CLI scripts', 'modifying tools/'],
      related: ['development.coding-conventions'],
      file: 'docs/development/node-tooling-guidelines.md',
      scope: 'tooling',
    },
  ];

  const sampleRules = [
    {
      rule_id: 'RT-16',
      path_glob: 'tools/dashboard/ui/**',
      doc_ref: 'docs/development/react-component-guidelines.md',
      source: 'docs/ai/task-routing.md',
    },
    {
      rule_id: 'RT-17',
      path_glob: 'tools/dashboard/ui/**',
      doc_ref: 'docs/development/ui-ux-guidelines.md',
      source: 'docs/ai/task-routing.md',
    },
    {
      rule_id: 'RT-20',
      path_glob: 'tools/dashboard/ui/foundations/**',
      doc_ref: 'docs/development/storybook.md',
      source: 'docs/ai/task-routing.md',
    },
    {
      rule_id: 'RT-27',
      path_glob: 'tools/docs/**',
      doc_ref: 'docs/development/node-tooling-guidelines.md',
      source: 'docs/ai/task-routing.md',
    },
  ];

  describe('query search', () => {
    test('searches case-insensitively across id, title, summary, read_when, and related', () => {
      const results = findDocs(sampleDocs, { query: 'SEMANTIC COLOR' });
      assert.ok(results.length >= 2);
      assert.equal(results[0].id, 'development.ui-ux-guidelines');
      assert.ok(results[0].score > 0);
    });

    test('prioritizes exact ID or title match over partial matches', () => {
      const results = findDocs(sampleDocs, { query: 'ui and ux guidelines' });
      assert.equal(results[0].id, 'development.ui-ux-guidelines');
    });

    test('orders results deterministically by score descending, then id ascending', () => {
      const results = findDocs(sampleDocs, { query: 'guidelines' });
      assert.ok(results.length > 1);
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i - 1].score > results[i].score ||
          (results[i - 1].score === results[i].score && results[i - 1].id.localeCompare(results[i].id) <= 0)
        );
      }
    });

    test('filters out documents with zero query matches', () => {
      const results = findDocs(sampleDocs, { query: 'nonexistent-term-xyz-123' });
      assert.equal(results.length, 0);
    });
  });

  describe('path discovery', () => {
    test('resolves governing documents from routing rules for a given file path', () => {
      const results = findDocs(sampleDocs, {
        path: 'tools/dashboard/ui/foundations/colors.stories.tsx',
        routingRules: sampleRules,
      });

      const ids = results.map(r => r.id).sort();
      assert.deepEqual(ids, [
        'development.react-component-guidelines',
        'development.storybook',
        'development.ui-ux-guidelines',
      ]);

      const storybookDoc = results.find(r => r.id === 'development.storybook');
      assert.equal(storybookDoc.rule_id, 'RT-20');
      assert.ok(storybookDoc.match_reason.includes('RT-20'));
      assert.ok(Array.isArray(storybookDoc.routing_rules));
    });

    test('resolves governing documents for directory path', () => {
      const results = findDocs(sampleDocs, {
        path: 'tools/docs',
        routingRules: sampleRules,
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'development.node-tooling-guidelines');
      assert.equal(results[0].rule_id, 'RT-27');
    });
  });

  describe('combined filters and backwards compatibility', () => {
    test('supports combining --path, --query, and --type', () => {
      const results = findDocs(sampleDocs, {
        path: 'tools/dashboard/ui/foundations/colors.stories.tsx',
        query: 'Storybook',
        type: 'development',
        routingRules: sampleRules,
      });

      assert.equal(results.length, 2);
      assert.equal(results[0].id, 'development.storybook');
    });

    test('preserves backwards-compatible scope and type filtering', () => {
      const results = findDocs(sampleDocs, { scope: 'tooling', type: 'development' });
      assert.equal(results.length, 1);
      assert.equal(results[0].id, 'development.node-tooling-guidelines');
    });

    test('returns rich JSON-serializable document objects', () => {
      const results = findDocs(sampleDocs, {
        path: 'tools/docs/service.mjs',
        query: 'standards',
        routingRules: sampleRules,
      });

      assert.equal(results.length, 1);
      const doc = results[0];
      assert.ok(doc.id);
      assert.ok(doc.file);
      assert.ok(doc.title);
      assert.ok(doc.summary);
      assert.ok(doc.read_when);
      assert.ok(doc.rule_id);
      assert.ok(doc.match_reason);
      assert.ok(typeof doc.score === 'number');

      const json = JSON.stringify(results);
      const parsed = JSON.parse(json);
      assert.equal(parsed[0].id, doc.id);
    });
  });
});
