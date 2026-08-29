import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyCodexSchema, verifyGeneratedSchemaDirectory } from '../server/ai/providers/codex/verify-schema.mjs';

const CODEX_PROVIDER_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'server', 'ai', 'providers', 'codex');
const BASELINE_PATH = join(CODEX_PROVIDER_ROOT, 'protocol-baseline.json');

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function methodSchema(methods) {
  return {
    oneOf: methods.map(method => ({ properties: { method: { enum: [method] } } })),
  };
}

async function createCompatibleSchemaFixture(root, baseline) {
  await writeJson(join(root, 'ClientRequest.json'), methodSchema(baseline.methods.clientRequests));
  await writeJson(join(root, 'ClientNotification.json'), methodSchema(baseline.methods.clientNotifications));
  await writeJson(join(root, 'ServerNotification.json'), methodSchema([
    ...baseline.methods.serverNotifications,
    ...baseline.observedProviderGlobalNotifications,
  ]));
  await writeJson(join(root, 'ServerRequest.json'), methodSchema(baseline.methods.serverRequests));
  const paths = new Set([...Object.keys(baseline.types), ...Object.keys(baseline.taggedVariants ?? {})]);
  for (const relativePath of paths) {
    const required = baseline.types[relativePath] ?? [];
    const definitions = {};
    for (const [index, variant] of (baseline.taggedVariants?.[relativePath] ?? []).entries()) {
      const properties = { [variant.tag]: { enum: [variant.value] } };
      for (const [property, values] of Object.entries(variant.optionalPropertyEnums ?? {})) {
        properties[property] = { anyOf: [{ enum: values }, { type: 'null' }] };
      }
      definitions[`Variant${index}`] = { properties, required: [variant.tag], type: 'object' };
    }
    await writeJson(join(root, ...relativePath.split('/')), { required, definitions });
  }
}

test('compact baseline describes exact implementation-time version and envelope policy', async () => {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  assert.equal(baseline.generatedWith.codexCliVersion, '0.149.0');
  assert.equal(baseline.generatedWith.verifiedOn, '2026-08-22');
  assert.equal(baseline.envelope.outgoingJsonrpc, 'omitted');
  assert.equal(baseline.envelope.incomingJsonrpc20, 'tolerated');
  assert.ok(baseline.methods.clientRequests.includes('thread/start'));
  assert.deepEqual(
    baseline.methods.serverRequests.filter(method => method.includes('requestApproval')),
    [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
    ],
  );
  assert.ok(baseline.methods.serverRequests.includes('item/tool/requestUserInput'));
});

test('schema-directory verifier accepts the consumed method and type inventory', async () => {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'nevo-codex-schema-test-'));
  try {
    await createCompatibleSchemaFixture(root, baseline);
    assert.deepEqual(await verifyGeneratedSchemaDirectory(root, baseline), { ok: true, errors: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema-directory verifier reports missing methods and required fields', async () => {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'nevo-codex-schema-test-'));
  try {
    await createCompatibleSchemaFixture(root, baseline);
    await writeJson(join(root, 'ClientRequest.json'), methodSchema(['initialize']));
    await writeJson(join(root, 'v2', 'TurnStartParams.json'), { required: ['threadId'] });
    const result = await verifyGeneratedSchemaDirectory(root, baseline);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes("client request method 'thread/start'")));
    assert.ok(result.errors.some(error => error.includes("TurnStartParams.json' no longer requires 'input'")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema-directory verifier requires optional agentMessage phase semantics', async () => {
  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  const root = await mkdtemp(join(tmpdir(), 'nevo-codex-schema-phase-test-'));
  try {
    await createCompatibleSchemaFixture(root, baseline);
    await writeJson(join(root, 'v2', 'ItemStartedNotification.json'), {
      required: baseline.types['v2/ItemStartedNotification.json'],
      definitions: {
        AgentMessage: {
          properties: {
            type: { enum: ['agentMessage'] },
            phase: { enum: ['commentary'] },
          },
          required: ['type', 'phase'],
        },
      },
    });
    const result = await verifyGeneratedSchemaDirectory(root, baseline);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes("optional 'phase'") && error.includes('final_answer')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('default verifier clearly skips an absent Codex executable while strict mode fails', async () => {
  const executable = `definitely-missing-codex-${Date.now()}`;
  const result = await verifyCodexSchema({ executable });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /not found/i);
  await assert.rejects(verifyCodexSchema({ executable, strict: true }), /not found/i);
});
