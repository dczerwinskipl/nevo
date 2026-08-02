// Tests for tools/lib/yaml.mjs — the shared YAML/front-matter helpers backed by
// the `yaml` package. Run: node --test tools/tests/
//
// This replaces the old hand-rolled YAML-subset parser that lived directly in
// tools/specs.mjs and tools/docs.mjs. Some assertions here are an intentional
// behavior change from that parser: real YAML correctly parses flow collections
// (`{}`, `[1, 2, 3]`) and mid-line comments, which the old subset parser did not
// implement — see the repo-tools refactor's final report for details.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseYamlFile, extractFrontMatter, parseFrontMatter, parseFrontMatterFile, updateYamlFile,
} from '../lib/yaml.mjs';
import { CliError } from '../lib/cli-errors.mjs';

let dir;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'nevo-yaml-test-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeTmp(name, content) {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('parseYamlFile', () => {
  test('parses flat and nested mappings, block lists, scalars', () => {
    const file = writeTmp('a.yaml', [
      'id: my-change',
      'title: Some Title Here',
      't: true',
      'f: false',
      'n: null',
      'tilde_n: ~',
      'count: 42',
      'neg: -3',
      'context:',
      '  required: []',
      '  optional: []',
      'items:',
      '  - one',
      '  - two',
    ].join('\n'));
    const result = parseYamlFile(file);
    assert.equal(result.id, 'my-change');
    assert.equal(result.title, 'Some Title Here');
    assert.equal(result.t, true);
    assert.equal(result.f, false);
    assert.equal(result.n, null);
    assert.equal(result.tilde_n, null);
    assert.equal(result.count, 42);
    assert.equal(typeof result.count, 'number');
    assert.equal(result.neg, -3);
    assert.deepEqual(result.context.required, []);
    assert.deepEqual(result.items, ['one', 'two']);
  });

  test('nested task list with depends_on parses correctly (regression guard)', () => {
    const file = writeTmp('b.yaml', [
      'tasks:',
      '  - id: a',
      '    order: 1',
      '    status: draft',
      '  - id: b',
      '    order: 2',
      '    status: draft',
      '    depends_on:',
      '      - a',
    ].join('\n'));
    const result = parseYamlFile(file);
    assert.equal(result.tasks.length, 2);
    assert.deepEqual(result.tasks[1].depends_on, ['a']);
  });

  test('quoted scalars are unwrapped', () => {
    const file = writeTmp('c.yaml', `a: "quoted value"\nb: 'single quoted'\n`);
    const result = parseYamlFile(file);
    assert.equal(result.a, 'quoted value');
    assert.equal(result.b, 'single quoted');
  });

  test('flow collections now parse structurally (intentional behavior change from the old subset parser)', () => {
    const file = writeTmp('d.yaml', 'a: {x: 1}\nb: [1, 2, 3]\nc: {}\n');
    const result = parseYamlFile(file);
    assert.deepEqual(result.a, { x: 1 });
    assert.deepEqual(result.b, [1, 2, 3]);
    assert.deepEqual(result.c, {});
  });

  test('a value containing an unquoted " #" is treated as a real YAML comment (intentional behavior change)', () => {
    const file = writeTmp('e.yaml', 'title: Guard (PR #13 fix)\n');
    const result = parseYamlFile(file);
    assert.equal(result.title, 'Guard (PR');
  });

  test('quoting a value containing "#" preserves it in full', () => {
    const file = writeTmp('f.yaml', 'title: "Guard (PR #13 fix)"\n');
    const result = parseYamlFile(file);
    assert.equal(result.title, 'Guard (PR #13 fix)');
  });

  test('a folded (>) block scalar has its trailing newline trimmed', () => {
    const file = writeTmp('g.yaml', 'summary: >\n  Line one\n  line two.\n');
    const result = parseYamlFile(file);
    assert.equal(result.summary, 'Line one line two.');
  });

  test('invalid YAML throws a CliError that names the file path', () => {
    const file = writeTmp('invalid.yaml', 'a: [1, 2\n');
    assert.throws(() => parseYamlFile(file), (err) => {
      assert.ok(err instanceof CliError);
      assert.match(err.message, new RegExp(file.replace(/\\/g, '\\\\')));
      return true;
    });
  });
});

describe('extractFrontMatter', () => {
  test('returns the raw block text when present', () => {
    const raw = extractFrontMatter('---\nid: x\n---\n\nBody text\n');
    assert.equal(raw.trim(), 'id: x');
  });

  test('returns null when there is no front matter block', () => {
    assert.equal(extractFrontMatter('# Just a heading\n\nNo front matter here.\n'), null);
  });
});

describe('parseFrontMatter', () => {
  test('parses a present block', () => {
    const result = parseFrontMatter('---\nid: fixture.t\nread_when:\n  - starting a task\n  - reviewing a PR\n---\n# Task\n', 'x.md');
    assert.equal(result.id, 'fixture.t');
    assert.deepEqual(result.read_when, ['starting a task', 'reviewing a PR']);
  });

  test('returns null (not {}) when there is no block at all', () => {
    assert.equal(parseFrontMatter('# No front matter\n', 'x.md'), null);
  });

  test('an empty-but-present block parses to {}, distinct from a missing block', () => {
    assert.deepEqual(parseFrontMatter('---\n\n---\nBody\n', 'x.md'), {});
  });

  test('invalid YAML front matter throws a CliError that names the file path', () => {
    assert.throws(() => parseFrontMatter('---\na: [1, 2\n---\n', 'broken.md'), (err) => {
      assert.ok(err instanceof CliError);
      assert.match(err.message, /broken\.md/);
      return true;
    });
  });
});

describe('parseFrontMatterFile', () => {
  test('returns {} for a missing file', () => {
    assert.deepEqual(parseFrontMatterFile(join(dir, 'does-not-exist.md')), {});
  });

  test('returns {} for a file with no front matter', () => {
    const file = writeTmp('no-fm.md', '# Just a heading\n');
    assert.deepEqual(parseFrontMatterFile(file), {});
  });

  test('returns parsed front matter for a file that has it', () => {
    const file = writeTmp('has-fm.md', '---\nid: x\n---\nBody\n');
    assert.deepEqual(parseFrontMatterFile(file), { id: 'x' });
  });
});

describe('updateYamlFile — structural update', () => {
  test('mutates one field while preserving comments and unrelated content', () => {
    const file = writeTmp('update.yaml', [
      '# a leading comment',
      'id: my-change',
      'status: draft # inline comment',
      'tasks:',
      '  - id: a',
      '    status: draft',
      '  - id: b',
      '    status: draft',
    ].join('\n'));

    updateYamlFile(file, (doc) => {
      const tasks = doc.get('tasks', true);
      const item = tasks.items.find((it) => it.get('id') === 'b');
      item.set('status', 'approved');
    });

    const after = parseYamlFile(file);
    assert.equal(after.tasks[0].status, 'draft', 'unrelated task must be untouched');
    assert.equal(after.tasks[1].status, 'approved');

    const rawAfter = readFileSync(file, 'utf8');
    assert.match(rawAfter, /# a leading comment/, 'comments must be preserved');
    assert.match(rawAfter, /# inline comment/, 'comments must be preserved');
  });

  test('mutating the top-level status field works', () => {
    const file = writeTmp('update2.yaml', 'id: x\nstatus: draft\n');
    updateYamlFile(file, (doc) => doc.set('status', 'approved'));
    assert.equal(parseYamlFile(file).status, 'approved');
  });
});
