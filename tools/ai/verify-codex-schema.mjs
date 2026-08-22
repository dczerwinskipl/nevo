import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodexCommand } from './codex-app-server-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'codex-protocol-baseline.json');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function methodsFrom(schema) {
  return new Set((schema.oneOf ?? []).flatMap(entry => entry?.properties?.method?.enum ?? []));
}

function requireMethods(actual, required, category, errors) {
  for (const method of required) {
    if (!actual.has(method)) errors.push(`${category} method '${method}' is missing`);
  }
}

export async function verifyGeneratedSchemaDirectory(schemaRoot, baseline) {
  const errors = [];
  const [clientRequests, clientNotifications, serverNotifications, serverRequests] = await Promise.all([
    readJson(join(schemaRoot, 'ClientRequest.json')),
    readJson(join(schemaRoot, 'ClientNotification.json')),
    readJson(join(schemaRoot, 'ServerNotification.json')),
    readJson(join(schemaRoot, 'ServerRequest.json')),
  ]);

  requireMethods(methodsFrom(clientRequests), baseline.methods.clientRequests, 'client request', errors);
  requireMethods(methodsFrom(clientNotifications), baseline.methods.clientNotifications, 'client notification', errors);
  requireMethods(methodsFrom(serverNotifications), baseline.methods.serverNotifications, 'server notification', errors);
  requireMethods(methodsFrom(serverNotifications), baseline.observedProviderGlobalNotifications, 'observed global notification', errors);
  requireMethods(methodsFrom(serverRequests), baseline.methods.serverRequests, 'server request', errors);

  for (const [relativePath, requiredProperties] of Object.entries(baseline.types)) {
    let schema;
    try {
      schema = await readJson(join(schemaRoot, ...relativePath.split('/')));
    } catch (error) {
      errors.push(`type schema '${relativePath}' is missing or unreadable: ${error.message}`);
      continue;
    }
    const actualRequired = new Set(schema.required ?? []);
    for (const property of requiredProperties) {
      if (!actualRequired.has(property)) {
        errors.push(`type '${relativePath}' no longer requires '${property}'`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    ...options,
  });
}

export async function verifyCodexSchema({
  executable = 'codex',
  strict = false,
  baselinePath = BASELINE_PATH,
} = {}) {
  const baseline = await readJson(baselinePath);
  const resolved = resolveCodexCommand(executable);
  const runCodex = args => commandResult(resolved.executable, [...resolved.argsPrefix, ...args]);
  const versionProbe = runCodex(['--version']);
  if (versionProbe.error?.code === 'ENOENT' || versionProbe.status === 9009) {
    if (strict) throw new Error(`Codex executable '${executable}' was not found.`);
    return { ok: true, skipped: true, reason: `Codex executable '${executable}' was not found.` };
  }
  if (versionProbe.error || versionProbe.status !== 0) {
    const reason = versionProbe.error?.message || versionProbe.stderr?.trim() || 'version probe failed';
    if (strict) throw new Error(`Unable to run Codex: ${reason}`);
    return { ok: true, skipped: true, reason: `Unable to run Codex: ${reason}` };
  }

  const versionOutput = `${versionProbe.stdout ?? ''} ${versionProbe.stderr ?? ''}`.trim();
  const actualVersion = versionOutput.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
  if (!actualVersion) throw new Error(`Unable to parse Codex version from '${versionOutput}'.`);
  const expectedVersion = baseline.generatedWith.codexCliVersion;
  if (actualVersion !== expectedVersion) {
    throw new Error(`Codex version mismatch: baseline ${expectedVersion}, installed ${actualVersion}.`);
  }

  const schemaRoot = await mkdtemp(join(tmpdir(), 'nevo-codex-schema-'));
  try {
    const generation = runCodex(['app-server', 'generate-json-schema', '--out', schemaRoot]);
    if (generation.error || generation.status !== 0) {
      const detail = generation.error?.message || generation.stderr?.trim() || 'schema generation failed';
      throw new Error(`Codex schema generation failed: ${detail}`);
    }
    const verification = await verifyGeneratedSchemaDirectory(schemaRoot, baseline);
    if (!verification.ok) {
      throw new Error(`Codex schema compatibility failed:\n- ${verification.errors.join('\n- ')}`);
    }
    return { ok: true, skipped: false, version: actualVersion };
  } finally {
    await rm(schemaRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const executableIndex = args.indexOf('--executable');
  const executable = executableIndex >= 0 ? args[executableIndex + 1] : 'codex';
  if (executableIndex >= 0 && !executable) throw new Error("'--executable' requires a value.");

  const result = await verifyCodexSchema({ executable, strict });
  if (result.skipped) {
    console.log(`SKIP: ${result.reason}`);
  } else {
    console.log(`Codex app-server schema compatible (codex-cli ${result.version}).`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
