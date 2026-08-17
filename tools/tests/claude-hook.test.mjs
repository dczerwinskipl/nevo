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

function runHookSubprocess(inputObject, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_SCRIPT_PATH], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Hook subprocess exited with code ${code}: ${stderr}`));
      }
      try {
        const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : null;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse hook stdout: ${stdout} (${err.message})`));
      }
    });

    child.on('error', reject);
    child.stdin.end(JSON.stringify(inputObject) + '\n');
  });
}

test('Hook subprocess: unconfigured / default tools return allow', async () => {
  const result = await runHookSubprocess({
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

test('Hook subprocess: AskUserQuestion without resolved response returns defer', async () => {
  const result = await runHookSubprocess({
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

test('Hook subprocess: AskUserQuestion with resolved response maps answers to question text and returns allow + updatedInput', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-test-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-q-resolve',
      interactionId: 'int-12345',
      toolUseId: 'toolu_q_99',
      toolName: 'AskUserQuestion',
      toolInput: {
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

    const result = await runHookSubprocess({
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
    assert.deepEqual(result.hookSpecificOutput?.updatedInput, {
      questions: [
        { question: 'What database do you prefer?', header: 'DB', options: ['PostgreSQL', 'SQLite'] },
      ],
      answers: {
        'What database do you prefer?': 'PostgreSQL',
      },
    });

    // Continuation marked delivered on disk (not deleted!)
    const remaining = store.getContinuation('sess-q-resolve', 'int-12345');
    assert.ok(remaining);
    assert.equal(remaining.state, 'delivered');
    assert.ok(remaining.deliveredAt);
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});

test('Hook subprocess: Wrong toolUseId correlation does not consume unrelated continuation and returns defer', async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), 'nevo-hook-mismatch-'));
  try {
    const store = createClaudeContinuationStore({ baseDir: join(tmpBase, '.nevo-ai-local', 'transcripts', 'claude', 'continuations') });
    store.saveDeferred({
      providerSessionId: 'sess-mismatch',
      interactionId: 'int-mismatch-1',
      toolUseId: 'tool-A',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [{ question: 'Color?', options: ['Red'] }] },
    });

    store.resolveResponse({
      providerSessionId: 'sess-mismatch',
      interactionId: 'int-mismatch-1',
      userResponse: { answers: [{ questionId: 'q-1', value: 'Red' }] },
    });

    // Invoking hook with tool-B (different tool_use_id and different input)
    const result = await runHookSubprocess({
      session_id: 'sess-mismatch',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tool-B',
      tool_input: { questions: [{ question: 'Size?', options: ['Large'] }] },
    }, { cwd: tmpBase });

    // Must return defer for unresolved tool-B
    assert.deepEqual(result, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
      },
    });

    // Must leave int-mismatch-1 unconsumed in resolved state
    const record = store.getContinuation('sess-mismatch', 'int-mismatch-1');
    assert.ok(record);
    assert.equal(record.state, 'resolved');
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
});
