// Tests for the custom YAML-subset parsers in tools/specs.mjs and tools/docs.mjs.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseYaml } from '../specs.mjs';
import { parseYamlSubset, parseScalar as docsParseScalar } from '../docs.mjs';

describe('tools/specs.mjs parseYaml', () => {
  test('parses inline [] as an empty array', () => {
    const result = parseYaml('context:\n  required: []\n  optional: []\n');
    assert.deepEqual(result.context.required, []);
    assert.deepEqual(result.context.optional, []);
    assert.ok(Array.isArray(result.context.required), 'required must be a real array');
  });

  test('does not treat inline {} as an empty object — falls through to a literal scalar', () => {
    const result = parseYaml('foo: {}\n');
    // {} is deliberately unsupported: it must not silently become a JS object.
    assert.notEqual(typeof result.foo, 'object');
    assert.equal(result.foo, '{}');
  });

  test('unquoted scalar values remain unchanged', () => {
    const result = parseYaml('id: nevo-documentation-foundation\ntitle: Some Title Here\n');
    assert.equal(result.id, 'nevo-documentation-foundation');
    assert.equal(result.title, 'Some Title Here');
  });

  test('quoted scalar values are unwrapped but otherwise unchanged', () => {
    const result = parseYaml(`a: "quoted value"\nb: 'single quoted'\n`);
    assert.equal(result.a, 'quoted value');
    assert.equal(result.b, 'single quoted');
  });

  test('booleans, null, and integers retain existing behavior', () => {
    const result = parseYaml('t: true\nf: false\nn: null\ntilde_n: ~\ncount: 42\nneg: -3\n');
    assert.equal(result.t, true);
    assert.equal(result.f, false);
    assert.equal(result.n, null);
    assert.equal(result.tilde_n, null);
    assert.equal(result.count, 42);
    assert.equal(result.neg, -3);
    assert.equal(typeof result.count, 'number');
  });

  test('unsupported inline YAML constructs do not silently produce unexpected object types', () => {
    // Flow-style inline lists/maps with content ({a: 1}, [1, 2]) are not part of this
    // subset — they must come back as plain strings, never as parsed structures that
    // could be silently misinterpreted downstream.
    const result = parseYaml('a: {x: 1}\nb: [1, 2, 3]\n');
    assert.equal(typeof result.a, 'string');
    assert.equal(typeof result.b, 'string');
  });

  test('block lists still parse as real arrays (regression guard)', () => {
    const result = parseYaml('items:\n  - one\n  - two\n  - three\n');
    assert.deepEqual(result.items, ['one', 'two', 'three']);
  });

  test('nested task list with depends_on parses correctly (regression guard)', () => {
    const yaml = [
      'tasks:',
      '  - id: a',
      '    order: 1',
      '    status: draft',
      '  - id: b',
      '    order: 2',
      '    status: draft',
      '    depends_on:',
      '      - a',
    ].join('\n');
    const result = parseYaml(yaml);
    assert.equal(result.tasks.length, 2);
    assert.deepEqual(result.tasks[1].depends_on, ['a']);
  });
});

describe('tools/docs.mjs parseYamlSubset / parseScalar', () => {
  test('parses inline [] as an empty array', () => {
    const result = parseYamlSubset('related: []\n');
    assert.deepEqual(result.related, []);
  });

  test('parseScalar({}) does not produce an object', () => {
    assert.notEqual(typeof docsParseScalar('{}'), 'object');
    assert.equal(docsParseScalar('{}'), '{}');
  });

  test('parseScalar: quoted and unquoted values unchanged', () => {
    assert.equal(docsParseScalar('unquoted'), 'unquoted');
    assert.equal(docsParseScalar('"quoted"'), 'quoted');
    assert.equal(docsParseScalar("'single'"), 'single');
  });

  test('parseScalar: booleans, null, integers retain existing behavior', () => {
    assert.equal(docsParseScalar('true'), true);
    assert.equal(docsParseScalar('false'), false);
    assert.equal(docsParseScalar('null'), null);
    assert.equal(docsParseScalar('~'), null);
    assert.equal(docsParseScalar('7'), 7);
    assert.equal(typeof docsParseScalar('7'), 'number');
  });

  test('block list of strings still parses correctly (regression guard)', () => {
    const result = parseYamlSubset('read_when:\n  - starting a task\n  - reviewing a PR\n');
    assert.deepEqual(result.read_when, ['starting a task', 'reviewing a PR']);
  });
});
