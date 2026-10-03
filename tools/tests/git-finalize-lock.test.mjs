// Tests for git-finalize-lock (D47, D50, D51).
// Run: node --test tools/tests/git-finalize-lock.test.mjs

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquireGitFinalizeLease,
  releaseGitFinalizeLease,
  withGitFinalizeLock,
} from '../specs/workflow/git-finalize-lock.mjs';

describe('git-finalize-lock (D50, D51)', () => {
  let tempRepoRoot;

  beforeEach(() => {
    tempRepoRoot = fs.mkdtempSync(path.join(tmpdir(), 'nevo-git-finalize-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    } catch {}
  });

  test('Acquires and releases a fresh lease successfully', async () => {
    const lease = await acquireGitFinalizeLease({ repoRoot: tempRepoRoot, timeoutMs: 1000 });
    assert.ok(lease.ownerId);
    assert.equal(lease.pid, process.pid);

    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
    assert.ok(fs.existsSync(lockPath));

    const released = lease.release();
    assert.equal(released, true);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test('Lease-passing: passing an existingLease triggers zero additional acquisitions and does not release', async () => {
    let innerRan = false;
    await withGitFinalizeLock(async (outerLease) => {
      assert.ok(outerLease.ownerId);
      // Run with existing lease
      await withGitFinalizeLock(async (innerLease) => {
        innerRan = true;
        assert.equal(innerLease.ownerId, outerLease.ownerId);
      }, outerLease);

      const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
      assert.ok(fs.existsSync(lockPath), 'Lock file should still exist while outer lease is held');
    }, { repoRoot: tempRepoRoot });

    assert.equal(innerRan, true);
    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
    assert.equal(fs.existsSync(lockPath), false, 'Lock file should be cleaned up after outer lease completes');
  });

  test('Reclaims stale lease left by confirmed-dead PID without hanging', async () => {
    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    // Write a lock file with a non-existent dead PID (e.g. 99999999)
    const deadLease = {
      ownerId: 'dead-owner-id',
      pid: 99999999,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(deadLease, null, 2), 'utf8');

    // Should detect dead PID and acquire immediately
    const freshLease = await acquireGitFinalizeLease({ repoRoot: tempRepoRoot, timeoutMs: 1000 });
    assert.ok(freshLease.ownerId);
    assert.notEqual(freshLease.ownerId, 'dead-owner-id');
    assert.equal(freshLease.pid, process.pid);

    freshLease.release();
  });

  test('Two concurrent acquisitions without shared lease serialize correctly', async () => {
    const sequence = [];

    const p1 = withGitFinalizeLock(async () => {
      sequence.push('p1-start');
      await new Promise(r => setTimeout(r, 100));
      sequence.push('p1-end');
    }, { repoRoot: tempRepoRoot, timeoutMs: 3000 });

    const p2 = withGitFinalizeLock(async () => {
      sequence.push('p2-start');
      await new Promise(r => setTimeout(r, 50));
      sequence.push('p2-end');
    }, { repoRoot: tempRepoRoot, timeoutMs: 3000 });

    await Promise.all([p1, p2]);

    assert.deepEqual(sequence, ['p1-start', 'p1-end', 'p2-start', 'p2-end']);
  });

  test('Release with mismatched ownerId is a no-op that does not delete another lease', async () => {
    const lease = await acquireGitFinalizeLease({ repoRoot: tempRepoRoot, timeoutMs: 1000 });
    const released = releaseGitFinalizeLease({ repoRoot: tempRepoRoot, ownerId: 'wrong-owner-id' });
    assert.equal(released, false);

    const lockPath = path.join(tempRepoRoot, '.nevo-ai-local', 'locks', 'git-finalize.lock');
    assert.ok(fs.existsSync(lockPath), 'Lock file must still exist after mismatched release');

    lease.release();
  });
});
