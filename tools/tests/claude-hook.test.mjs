import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClaudeContinuationStore } from '../ai/claude-continuation-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SCRIPT_PATH = join(__dirname, '..', 'ai', 'claude-hook.mjs');

function runHookProcess(inputObject, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HOOK_SCRIPT_PATH], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Hook exited with code ${code}: ${stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse hook stdout: ${stdout} (${err.message})`));
      }
    });

    child.on('error', reject);
    child.stdin.write(JSON.stringify(inputObject) + '\n');
    child.stdin.end();
  });
}

test('Hook executable: unconfigured / default tools return allow', async () => {
  const result = await runHookProcess({
    session_id: 'sess-test-1',
    hook_event_name: 'PreToolUse',
    tool_name: 'ReadFile',
    tool_input: { file_path: 'foo.txt' },
    tool_use_id: 'toolu_read_1',
  });

  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  });
});

test('Hook executable: AskUserQuestion without resolved response returns defer', async () => {
  const result = await runHookProcess({
    session_id: 'sess-test-q-1',
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Color?', options: ['Red', 'Blue'] }] },
    tool_use_id: 'toolu_q_1',
  });

  assert.deepEqual(result, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'defer',
    },
  });
});

test('Hook executable: AskUserQuestion with resolved response maps answers to question text and returns allow + updatedInput', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-test-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-q-resolve',
      interactionId: 'int-12345',
      toolUseId: 'toolu_q_99',
      toolName: 'AskUserQuestion',
      originalToolInput: {
        questions: [
          { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
        ],
      },
    });

    store.resolveResponse({
      providerSessionId: 'sess-q-resolve',
      interactionId: 'int-12345',
      userResponse: {
        answers: [{ questionId: 'q-1', value: 'PostgreSQL' }],
      },
    });

    const result = await runHookProcess({
      session_id: 'sess-q-resolve',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
        ],
      },
      tool_use_id: 'toolu_q_99',
    }, { cwd: tmpBase });

    assert.equal(result.hookSpecificOutput?.hookEventName, 'PreToolUse');
    assert.equal(result.hookSpecificOutput?.permissionDecision, 'allow');
    assert.deepEqual(result.hookSpecificOutput?.updatedInput?.answers, {
      'What database do you prefer?': 'PostgreSQL',
    });

    // Continuation must be consumed
    const remaining = store.getContinuation('sess-q-resolve', 'int-12345');
    assert.equal(remaining, null);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Hook executable: Permission allow and deny responses return valid PreToolUse hookSpecificOutput', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-perm-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });

    // 1. Allow
    store.saveDeferred({
      providerSessionId: 'sess-perm-test',
      interactionId: 'int-allow-1',
      toolUseId: 'toolu_bash_1',
      toolName: 'Bash',
      originalToolInput: { command: 'npm test' },
    });
    store.resolveResponse({
      providerSessionId: 'sess-perm-test',
      interactionId: 'int-allow-1',
      userResponse: { decision: 'allow' },
    });

    const allowResult = await runHookProcess({
      session_id: 'sess-perm-test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'toolu_bash_1',
    }, { cwd: tmpBase });

    assert.deepEqual(allowResult, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });

    // 2. Deny
    store.saveDeferred({
      providerSessionId: 'sess-perm-test',
      interactionId: 'int-deny-1',
      toolUseId: 'toolu_bash_2',
      toolName: 'Bash',
      originalToolInput: { command: 'rm -rf /' },
    });
    store.resolveResponse({
      providerSessionId: 'sess-perm-test',
      interactionId: 'int-deny-1',
      userResponse: { decision: 'deny', message: 'Forbidden destructive command' },
    });

    const denyResult = await runHookProcess({
      session_id: 'sess-perm-test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      tool_use_id: 'toolu_bash_2',
    }, { cwd: tmpBase });

    assert.deepEqual(denyResult, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Forbidden destructive command',
      },
    });
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});
