import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  verificationFilePath,
  FileHumanVerificationStore,
} from '../specs/workflow/human-verification-store.mjs';
import { HumanVerificationGate } from '../specs/workflow/gates/human-gate.mjs';

function makeFixture(prefix) {
  const base = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { base, repo: base };
}

function cleanupFixture(fx) {
  try {
    rmSync(fx.base, { recursive: true, force: true });
  } catch {}
}

describe('FileHumanVerificationStore and attempt scoping (AC6)', () => {
  let fx;
  before(() => { fx = makeFixture('nevo-human-verif-test'); });
  after(() => cleanupFixture(fx));

  test('constructs path scoped to attempt directory', () => {
    const p1 = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 1, 'my-gate');
    const expected1 = join(fx.repo, '.nevo-ai-local', 'human-verifications', 'demo-change', 'demo-task', 'review', 'attempt-1', 'my-gate.json');
    assert.equal(p1, expected1);

    const p2 = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 2, 'my-gate');
    const expected2 = join(fx.repo, '.nevo-ai-local', 'human-verifications', 'demo-change', 'demo-task', 'review', 'attempt-2', 'my-gate.json');
    assert.equal(p2, expected2);
  });

  test('signoff confirmed on attempt 1 does NOT satisfy query on attempt 2', () => {
    const store = new FileHumanVerificationStore({
      repoRoot: fx.repo,
      change: 'demo-change',
      task: 'demo-task',
    });

    // Confirm signoff on attempt 1
    const signoff = store.confirm({
      scope: 'task',
      targetId: 'demo-task',
      role: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });

    assert.equal(signoff.confirmed, true);
    assert.equal(signoff.attempt, 1);

    const filePath = verificationFilePath(fx.repo, 'demo-change', 'demo-task', 'review', 1, 'human-review');
    assert.ok(existsSync(filePath), 'signoff file must exist in attempt-1 directory');

    // Query on attempt 1 finds the signoff
    const found1 = store.getSignoff({
      scope: 'task',
      targetId: 'demo-task',
      requiredRole: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });
    assert.ok(found1);
    assert.equal(found1.confirmed, true);
    assert.equal(found1.attempt, 1);

    // Query on attempt 2 does NOT find the signoff
    const found2 = store.getSignoff({
      scope: 'task',
      targetId: 'demo-task',
      requiredRole: 'owner',
      stepId: 'review',
      attempt: 2,
      gateId: 'human-review',
    });
    assert.equal(found2, null, 'attempt 2 query must return null when only attempt 1 is signed off');
  });

  test('HumanVerificationGate verification enforces attempt scoping via context.attempt on a single shared store/gate (corrective revision)', async () => {
    // A single store/gate pair, constructed with no attempt bound at all — attempt
    // identity must flow entirely through the per-call `context.attempt` the gate query
    // contract carries, not through hidden reader-instance state (which would trivially
    // "pass" this test even if the gate never actually threaded attempt through at all).
    const store = new FileHumanVerificationStore({
      repoRoot: fx.repo,
      change: 'demo-change',
      task: 'demo-task',
    });
    const gate = new HumanVerificationGate({ verificationReader: store });

    // Confirm on attempt 1 only
    store.confirm({
      scope: 'task',
      targetId: 'demo-task',
      role: 'owner',
      stepId: 'review',
      attempt: 1,
      gateId: 'human-review',
    });

    const baseContext = {
      change: { id: 'demo-change' },
      task: { id: 'demo-task' },
      step: { id: 'review' },
      repoRoot: fx.repo,
    };

    const res1 = await gate.verify({ id: 'human-review' }, { ...baseContext, attempt: 1 });
    assert.equal(res1.passed, true);

    const res2 = await gate.verify({ id: 'human-review' }, { ...baseContext, attempt: 2 });
    assert.equal(res2.passed, false);
    assert.equal(res2.status, 'blocked');
  });
});
