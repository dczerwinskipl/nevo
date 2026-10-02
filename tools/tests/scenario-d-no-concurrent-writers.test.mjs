// Acceptance Scenario D (regression) — no concurrent writers. Ties the pre-existing
// workspace-writer/activeExecutions mutual-exclusion guarantee (already covered at the
// primitive level by workspace-writer.test.mjs D65 and workflow-continuation.test.mjs
// AC409/D33) explicitly to this specification's own acceptance criteria, through the real
// `admitAgentExecution` admission path — not the workspace-writer primitive directly — so a
// future regression introduced by Area A/B (dirty-worktree remediation, resumable
// classification) would be caught here even if no functional change is otherwise needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  admitAgentExecution,
  releaseAdmittedExecution,
  resetAdmissionStateForTest,
} from '../dashboard/server/ai/orchestration/admission.mjs';
import { getWorkspaceWriterClaim } from '../specs/workflow/workspace-writer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createTempRepo(prefix) {
  const dir = path.join(REPO_ROOT, '.nevo-ai-local', `test-repo-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n', 'utf8');

  const wfDir = path.join(dir, '.nevo-ai', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  const realWfDir = path.join(REPO_ROOT, '.nevo-ai', 'workflows');
  if (fs.existsSync(realWfDir)) {
    for (const f of fs.readdirSync(realWfDir)) {
      if (f.endsWith('.yaml') || f.endsWith('.yml')) {
        fs.copyFileSync(path.join(realWfDir, f), path.join(wfDir, f));
      }
    }
  }

  const changeSlug = 'spec-scenario-d';
  const taskId = 't1';
  const specsDir = path.join(dir, 'specs', 'active');
  const sDir = path.join(specsDir, changeSlug);
  const tasksDir = path.join(sDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(
    path.join(sDir, 'change.yaml'),
    `schema_version: '1.0'
id: ${changeSlug}
title: ${changeSlug}
spec_id: '55555555-5555-4555-8555-555555555501'
workflow:
  mode: deterministic
  definition: standard
tasks:
  - id: ${taskId}
    file: tasks/${taskId}.md
    status: in-progress
`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(tasksDir, `${taskId}.md`),
    `---
id: ${taskId}
status: in-progress
allowed_paths:
  - README.md
---
# Task ${taskId}
`,
    'utf8'
  );

  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
  return { root: dir, activeDir: specsDir, changeSlug, taskId, specId: '55555555-5555-4555-8555-555555555501' };
}

describe('Acceptance Scenario D (regression): no concurrent writers', { concurrency: 1 }, () => {
  test('A second admission for the same task is blocked while agent X\'s turn is live, regardless of whether agent Y targets it via a fresh or a reuse session policy; once X is confirmed terminal, Y succeeds', async () => {
    resetAdmissionStateForTest();
    const fx = createTempRepo('scen-d-1');
    try {
      // Agent X is admitted via the default ("fresh") session policy.
      const admX = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-x', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admX.admitted, true, 'Agent X must be admitted');
      const claimAfterX = getWorkspaceWriterClaim(fx.root);
      assert.ok(claimAfterX, 'Claim must exist for agent X');

      // Agent Y attempts the SAME task via an explicit "reuse" session policy while X's
      // turn is still live (not terminal) — must not be admitted.
      const admYReuse = await admitAgentExecution(
        fx.specId,
        {
          taskId: fx.taskId,
          stepId: 'implementation',
          sessionId: 'sess-y-reuse',
          changeSlug: fx.changeSlug,
          sessionPolicy: 'reuse',
          parentSessionId: 'sess-x',
        },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admYReuse.admitted, false, 'A reuse-policy admission must not win while X is live');
      assert.equal(admYReuse.reason, 'ACTIVE_EXECUTION_EXISTS');

      // Agent Y attempts the same task again, this time via an explicit "fresh" session
      // policy — the other route's shape — still while X's turn is live.
      const admYFresh = await admitAgentExecution(
        fx.specId,
        {
          taskId: fx.taskId,
          stepId: 'implementation',
          sessionId: 'sess-y-fresh',
          changeSlug: fx.changeSlug,
          sessionPolicy: 'fresh',
        },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admYFresh.admitted, false, 'A fresh-policy admission must not win while X is live either');
      assert.equal(admYFresh.reason, 'ACTIVE_EXECUTION_EXISTS');

      // Exactly one live claim throughout — still owned by X.
      const claimStillX = getWorkspaceWriterClaim(fx.root);
      assert.ok(claimStillX);
      assert.equal(claimStillX.ownerId, admX.ownerId);

      // Agent X's turn is confirmed terminal (mid-flight active attempt abandoned —
      // outcome: resumable is the normal, expected way an unfinished step ends).
      const relRes = await releaseAdmittedExecution(fx.specId);
      assert.equal(relRes.released, true);
      assert.equal(getWorkspaceWriterClaim(fx.root), null, 'Claim must be released once X is terminal');

      // Agent Y's next attempt now succeeds — the block was specific to liveness, not a
      // permanent lockout introduced by Area A/B's resumable classification.
      const admYAfter = await admitAgentExecution(
        fx.specId,
        { taskId: fx.taskId, stepId: 'implementation', sessionId: 'sess-y-after', changeSlug: fx.changeSlug },
        { repoRoot: fx.root, activeDir: fx.activeDir }
      );
      assert.equal(admYAfter.admitted, true, 'Agent Y must be admitted once X is confirmed terminal');
      assert.notEqual(admYAfter.ownerId, admX.ownerId);

      await releaseAdmittedExecution(fx.specId);
    } finally {
      resetAdmissionStateForTest();
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
