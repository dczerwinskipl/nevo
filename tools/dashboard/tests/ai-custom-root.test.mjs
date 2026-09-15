import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { REPOSITORY_ROOT } from '../server/infrastructure/paths.mjs';
import { DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS, loadAgentProvidersConfig } from '../server/ai/providers/config.mjs';
import { createDefaultAgentSessionService } from '../server/ai/routes.mjs';
import { listen } from '../server/index.mjs';
import { buildAiTestApp } from './helpers/ai-test-app.mjs';
import { writeLegacySpecFixtureSync } from './helpers/spec-fixtures.mjs';

async function writeProvidersConfig(root, providers = 'mock') {
  await mkdir(join(root, '.nevo-ai-local'), { recursive: true });
  await writeFile(
    join(root, '.nevo-ai-local', 'ai-providers.yaml'),
    `version: 1\nproviders:\n  ${providers}:\n    enabled: true\n`,
    'utf8',
  );
}

function control(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nevo-dashboard-action': '1' },
    body: JSON.stringify(body),
  };
}

// `providerSessionId` is deterministic per fresh MockAgentProvider instance
// (`mock-session-001`, ...), so the real repository's own `.nevo-ai-local/`
// may already contain a same-named file from unrelated history (dev usage,
// other test runs). Existence alone can't prove isolation — instead, snapshot
// the real file's content before the turn and assert it is byte-for-byte
// unchanged afterward, which holds regardless of what pre-existing state
// happens to be on disk.
function snapshotRealRepoTranscript(providerSessionId) {
  const path = join(REPOSITORY_ROOT, '.nevo-ai-local', 'transcripts', 'mock', `${providerSessionId}.json`);
  return { path, existedBefore: existsSync(path), contentBefore: existsSync(path) ? readFileSync(path, 'utf8') : null };
}

function assertRealRepoTranscriptUntouched(snapshot) {
  if (!snapshot.existedBefore) {
    assert.ok(!existsSync(snapshot.path), `must not create '${snapshot.path}' in the real repository`);
    return;
  }
  assert.equal(
    readFileSync(snapshot.path, 'utf8'),
    snapshot.contentBefore,
    `must not modify pre-existing '${snapshot.path}' in the real repository`,
  );
}

async function waitForTurn(service, turnId, predicate) {
  for (let index = 0; index < 100; index += 1) {
    const turn = service.getTurn(turnId);
    if (predicate(turn)) return turn;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Timed out waiting for turn.');
}

// The bug this file exists to catch: `aiRoutes(fastify, { config })` used to
// ignore `config.root` entirely and call `createDefaultDashboardAiService()`
// with zero arguments, so a custom/worktree root only ever relocated Specs —
// every AI provider's cwd, its local-data paths (transcripts, session
// bindings), and its own configuration file kept silently reading and
// writing the real repository regardless of the configured root.
test('loadAgentProvidersConfig resolves the provider config file and Antigravity raw-capture dir under a custom root, never the real repository', async () => {
  const customRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-custom-root-config-'));
  try {
    await mkdir(join(customRoot, '.nevo-ai-local'), { recursive: true });
    await writeFile(
      join(customRoot, '.nevo-ai-local', 'ai-providers.yaml'),
      'version: 1\nproviders:\n  antigravity:\n    enabled: true\n',
      'utf8',
    );

    const config = loadAgentProvidersConfig({ repoRoot: customRoot });
    assert.equal(config.configPath, resolve(customRoot, '.nevo-ai-local', 'ai-providers.yaml'));
    assert.equal(config.providers.antigravity.rawCaptureDir, resolve(customRoot, '.nevo-ai-local', 'antigravity_raw'));
    assert.equal(config.providers.antigravity.printTimeoutSeconds, DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT_SECONDS);

    for (const value of [config.configPath, config.providers.antigravity.rawCaptureDir]) {
      assert.ok(
        !value.startsWith(REPOSITORY_ROOT),
        `expected '${value}' to stay under the custom root, not the real repository`,
      );
    }
  } finally {
    await rm(customRoot, { recursive: true, force: true });
  }
});

test('createDefaultAgentSessionService derives provider construction and local-data (transcript, binding) paths from a custom root', async () => {
  const customRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-custom-root-service-'));
  try {
    await writeProvidersConfig(customRoot, 'mock');
    const specId = randomUUID();
    // AgentSessionService's fail-closed contract (Task 02) rejects an explicit specId
    // that resolves to no real spec under its repoRoot — this test only cares about
    // provider/transcript/binding path derivation, so specId needs a genuine (legacy)
    // spec under the same customRoot, not a bare random label.
    writeLegacySpecFixtureSync(customRoot, specId);

    const service = createDefaultAgentSessionService({ root: customRoot });
    try {
      assert.deepEqual(service.registry.list(), ['mock']);

      // `providerSessionId` is predictable ahead of time (mock allocates
      // deterministically), so the real-repo snapshot can be taken first.
      const realRepoSnapshot = snapshotRealRepoTranscript('mock-session-001');

      const { turnId, sessionId } = await service.startTurn('mock', null, {
        message: 'hello from a custom root',
        specId,
      });
      await waitForTurn(service, turnId, (turn) => turn.status === 'completed');

      // The canonical transcript belongs to sessionId exactly once (see Section 2 of the
      // Task 02 corrective pass) — providerSessionId is only known asynchronously once the
      // provider establishes it, well after startTurn() has already returned, so the
      // transcript must be located by the always-populated canonical sessionId.
      // Transcript cache must have written under <customRoot>/.nevo-ai-local/transcripts,
      // never the real repository's own .nevo-ai-local/transcripts.
      const transcriptPath = join(customRoot, '.nevo-ai-local', 'transcripts', 'mock', `${sessionId}.json`);
      assert.ok(existsSync(transcriptPath), `expected transcript at '${transcriptPath}'`);
      assertRealRepoTranscriptUntouched(realRepoSnapshot);

      // Session binding must have written under <customRoot>/.nevo-ai-local/sessions.
      const bindingDir = join(customRoot, '.nevo-ai-local', 'sessions');
      assert.ok(existsSync(bindingDir), `expected binding storage directory at '${bindingDir}'`);
      const bindingFiles = readdirSync(bindingDir, { recursive: true });
      assert.ok(bindingFiles.length > 0, 'expected at least one persisted binding file under the custom root');
    } finally {
      await service.shutdown();
    }
  } finally {
    await rm(customRoot, { recursive: true, force: true });
  }
});

// The bug this test exists to catch: AgentSessionService's deterministic workflow
// resolution (resolveDeterministicWorkflowInfo) used to receive no repoRoot at all and
// silently fell back to the process-global repository root — so a dashboard configured
// for a custom repository/worktree would resolve provider cwd, transcript storage, and
// binding storage from the custom root, but resolve deterministic workflow state (and
// thus the authoritative [Nevo Workflow Context] header) from the real repo / process
// cwd instead. This test's fixture change/workflow-definition files exist ONLY under
// `customRoot`, which is guaranteed to differ from `process.cwd()` here — under the bug,
// resolution against the wrong root would find nothing and the header would never be
// injected, so this test fails under the bug and passes once repoRoot is threaded
// through correctly. It never mutates the real process.cwd() to achieve this.
test('createDefaultAgentSessionService threads the custom root into deterministic workflow resolution, never process.cwd() or the real repository root', async () => {
  assert.notEqual(process.cwd(), REPOSITORY_ROOT, 'sanity: this test must not run from the real repository root');

  const customRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-custom-root-workflow-'));
  try {
    assert.notEqual(customRoot, process.cwd(), 'sanity: customRoot must differ from process.cwd()');
    await writeProvidersConfig(customRoot, 'mock');

    const specId = randomUUID();
    const changeDir = join(customRoot, 'specs', 'active', 'fixture-change');
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      join(changeDir, 'change.yaml'),
      `spec_id: ${specId}\nworkflow:\n  mode: deterministic\n  definition: standard-v1\ntasks:\n  - id: "01"\n    workflow_progress:\n      current_step: implementation\n      current_attempt: 1\n      state: active\n`,
      'utf-8',
    );
    await mkdir(join(customRoot, '.nevo-ai', 'workflows'), { recursive: true });
    await copyFile(
      join(REPOSITORY_ROOT, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
      join(customRoot, '.nevo-ai', 'workflows', 'standard-v1.yaml'),
    );

    const service = createDefaultAgentSessionService({ root: customRoot });
    try {
      const { turnId } = await service.startTurn('mock', null, {
        message: 'implement the thing',
        specId,
        taskId: '01',
      });
      await waitForTurn(service, turnId, (turn) => turn.status === 'completed' || turn.status === 'failed');

      // The canonical turn's `prompt` is the full enriched text actually sent to the
      // provider (header + userMessage) — reading it here observes what the provider
      // received without depending on any particular provider's internals.
      const canonicalTurn = service.getCanonicalTurn(turnId);
      assert.match(
        canonicalTurn.prompt,
        /\[Nevo Workflow Context\]/,
        'the authoritative deterministic header must be resolved from the configured custom root',
      );
      assert.match(canonicalTurn.prompt, /Step: implementation \(attempt 1\)/);
    } finally {
      await service.shutdown();
    }
  } finally {
    await rm(customRoot, { recursive: true, force: true });
  }
});

test('aiRoutes(fastify, { config: { root } }) threads the custom root through the real Fastify plugin boundary', async () => {
  const customRoot = await mkdtemp(join(tmpdir(), 'nevo-ai-custom-root-http-'));
  try {
    await writeProvidersConfig(customRoot, 'mock');
    const specId = randomUUID();
    // Same fail-closed contract as above: specId needs a genuine (legacy) spec under
    // this customRoot, since this test only cares about custom-root path threading, not
    // deterministic workflow resolution.
    writeLegacySpecFixtureSync(customRoot, specId);

    const server = await buildAiTestApp({ config: { root: customRoot } });
    const baseUrl = await listen(server, { port: 0 });
    try {
      const providers = await (await fetch(`${baseUrl}/api/agent-providers`)).json();
      assert.deepEqual(
        providers.providers.map((p) => p.id),
        ['mock'],
      );

      const realRepoSnapshot = snapshotRealRepoTranscript('mock-session-001');

      const started = await (
        await fetch(
          `${baseUrl}/api/agent-sessions/turns`,
          control({
            provider: 'mock',
            specId,
            message: 'hello via HTTP with a custom root',
          }),
        )
      ).json();

      // started.providerSessionId is only known asynchronously once the provider
      // establishes it, well after this POST already returned — the canonical sessionId
      // is the one identity guaranteed to be populated immediately (see Section 2 of the
      // Task 02 corrective pass), so it is the one to poll and locate the transcript by.
      for (let index = 0; index < 100; index += 1) {
        const check = await fetch(`${baseUrl}/api/agent-sessions/${started.sessionId}`);
        const body = (await check.json()).session;
        if (body.status === 'idle' && body.messages?.length >= 2) break;
        await new Promise((r) => setTimeout(r, 5));
      }

      const transcriptPath = join(
        customRoot,
        '.nevo-ai-local',
        'transcripts',
        'mock',
        `${started.sessionId}.json`,
      );
      assert.ok(existsSync(transcriptPath), `expected transcript at '${transcriptPath}'`);
      assertRealRepoTranscriptUntouched(realRepoSnapshot);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(customRoot, { recursive: true, force: true });
  }
});
