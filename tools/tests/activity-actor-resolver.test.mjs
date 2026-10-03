// Tests for the Activity history's actor resolver (task 03, ai-spec-history).
// Run: node --test tools/tests/activity-actor-resolver.test.mjs

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveUserActor, resolveAgentSessionActor, SYSTEM_ACTOR } from '../specs/activity/actor-resolver.mjs';
import { validateActivityEnvelope } from '../specs/activity/model.mjs';

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'nevo-actor-resolver-test-'));
  git(root, ['init', '-q']);
  return root;
}

// Points git's global/system config lookup at files that don't exist, so `git
// config user.name`/`user.email` fails deterministically regardless of the
// host machine's or CI runner's own configured identity — see the recent
// REC-03 fix for why relying on ambient environment state makes a test flaky.
function withNoGitConfig(fn) {
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'];
  const saved = {};
  for (const key of keys) saved[key] = process.env[key];
  process.env.GIT_CONFIG_GLOBAL = join(tmpdir(), 'nevo-actor-resolver-test-no-such-gitconfig-global');
  process.env.GIT_CONFIG_SYSTEM = join(tmpdir(), 'nevo-actor-resolver-test-no-such-gitconfig-system');
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function envelopeWithActor(actor) {
  return {
    id: 'envelope-test-id',
    type: 'test.activity.type',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    actor,
    scope: { specId: 'spec-test-uuid' },
  };
}

describe('Activity actor resolver', () => {
  const reposToClean = [];

  afterEach(() => {
    while (reposToClean.length) {
      rmSync(reposToClean.pop(), { recursive: true, force: true });
    }
  });

  test('with a git config carrying user.name/user.email, resolveUserActor returns a user ActorRef with a non-empty id', () => {
    const root = createRepo();
    reposToClean.push(root);
    git(root, ['config', 'user.name', 'Fixture User']);
    git(root, ['config', 'user.email', 'fixture-user@example.com']);

    const actor = resolveUserActor(root);

    assert.equal(actor.type, 'user');
    assert.equal(actor.id, 'fixture-user@example.com');
  });

  test('with user.name but no user.email, resolveUserActor falls back to the name', () => {
    const root = createRepo();
    reposToClean.push(root);
    git(root, ['config', 'user.name', 'Fixture User']);

    const actor = withNoGitConfig(() => resolveUserActor(root));

    assert.equal(actor.type, 'user');
    assert.equal(actor.id, 'Fixture User');
  });

  test('with no git config available (simulated), resolveUserActor returns the placeholder actor rather than throwing', () => {
    const root = createRepo();
    reposToClean.push(root);

    const actor = withNoGitConfig(() => resolveUserActor(root));

    assert.deepEqual(actor, { type: 'user', id: 'unknown-user' });
  });

  test('resolveAgentSessionActor and SYSTEM_ACTOR each produce a valid ActorRef per model.mjs\'s validator', () => {
    const agentSessionActor = resolveAgentSessionActor('session-abc-123');

    assert.deepEqual(agentSessionActor, { type: 'agent-session', id: 'session-abc-123' });
    assert.equal(validateActivityEnvelope(envelopeWithActor(agentSessionActor)).valid, true);
    assert.equal(validateActivityEnvelope(envelopeWithActor(SYSTEM_ACTOR)).valid, true);
    assert.deepEqual(SYSTEM_ACTOR, { type: 'system', id: 'nevo-workflow-engine' });
  });

  test('the three resolvers produce actors of visibly different type values', () => {
    const root = createRepo();
    reposToClean.push(root);
    git(root, ['config', 'user.name', 'Fixture User']);
    git(root, ['config', 'user.email', 'fixture-user@example.com']);

    const userActor = resolveUserActor(root);
    const agentSessionActor = resolveAgentSessionActor('session-abc-123');

    const types = new Set([userActor.type, agentSessionActor.type, SYSTEM_ACTOR.type]);
    assert.equal(types.size, 3);
    assert.deepEqual([...types].sort(), ['agent-session', 'system', 'user']);
  });
});
