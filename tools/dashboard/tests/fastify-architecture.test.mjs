import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-level regression guards: prevent the dashboard server from quietly
// regressing back to a handwritten HTTP router hidden behind Fastify (a
// central `fastify.all(...)` + `request.method` switch, or a wildcard +
// `reply.hijack()` + a second internal regex-based URL router for AI), and
// from re-fragmenting into a mix of a central `server/routes/` directory and
// sibling vertical-slice capability folders. These are deliberately simple
// text/filesystem checks, not behavioral tests — the other suites already
// prove the observable HTTP contract; this one proves the *architecture*
// doesn't drift back.

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');

// Every dashboard server capability lives as a sibling vertical slice
// directly under `server/`, each with a `routes.mjs` HTTP entry point.
const CAPABILITY_DIRS = ['ai', 'events', 'health', 'operations', 'pull-requests', 'specs'];

function listMjsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listMjsFiles(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

const capabilityFiles = CAPABILITY_DIRS.flatMap(dir => listMjsFiles(join(serverDir, dir)));

// Files where `reply.hijack()`/`reply.raw` is legitimate: genuine SSE
// streaming boundaries, not a substitute for Fastify's own routing.
const KNOWN_SSE_FILES = new Set([
  join(serverDir, 'events', 'routes.mjs'),
  join(serverDir, 'operations', 'routes.mjs'),
  join(serverDir, 'ai', 'events.mjs'),
]);

test('no dashboard capability module uses fastify.all(...) as its normal routing pattern', () => {
  for (const file of capabilityFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/\bfastify\.all\s*\(/.test(source) && !/\bscoped\.all\s*\(/.test(source),
      `${file} still registers routes via .all(...) — use a verb-specific registration (get/post/patch/delete) instead. An unsupported method on a known path is expected to fall through to Fastify's own generic 404, not a dedicated 405.`,
    );
  }
});

test('no dashboard capability module hand-dispatches on request.method after Fastify has already matched the route', () => {
  for (const file of capabilityFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/if\s*\(\s*request\.method\s*!==/.test(source),
      `${file} still branches on request.method inside a route handler — Fastify's own verb-specific registration should make this unnecessary.`,
    );
  }
});

test('no custom 405 method-fallback machinery exists (an unsupported method falls through to the generic 404)', () => {
  assert.equal(
    existsSync(join(serverDir, 'http-compat.mjs')),
    false,
    'http-compat.mjs (the old registerMethodFallback 405 helper) should have been removed — no dashboard consumer distinguishes 405 from 404.',
  );
});

test('reply.hijack()/reply.raw is confined to genuine SSE streaming boundaries', () => {
  for (const file of capabilityFiles) {
    const source = readFileSync(file, 'utf8');
    if (/reply\.hijack\(\)/.test(source)) {
      assert.ok(
        KNOWN_SSE_FILES.has(file),
        `${file} calls reply.hijack() but is not a recognized SSE route file — normal JSON API routes must stay inside Fastify's request/reply lifecycle.`,
      );
    }
  }
});

test('the AI capability has no second, internal URL router (no pathname regex/prefix dispatch)', () => {
  for (const file of listMjsFiles(join(serverDir, 'ai'))) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/url\.pathname\.match\(/.test(source),
      `${file} matches pathnames with a regex — AI routes must be registered as real Fastify routes (fastify.get/post/patch/delete with a concrete path), not dispatched by a second internal router.`,
    );
    assert.ok(
      !/pathname\.startsWith\(/.test(source),
      `${file} branches on a pathname prefix — this is exactly the old wildcard-dispatch pattern the migration retired.`,
    );
  }
});

test('the retired handwritten AI dispatcher no longer exists', () => {
  assert.equal(existsSync(join(serverDir, 'ai-routes.mjs')), false, 'ai-routes.mjs (the old pathname-dispatch HTTP router) should have been removed, not just unused.');
  assert.equal(existsSync(join(serverDir, 'routes')), false, 'server/routes/ (the old central routing directory) should have been removed in favor of sibling vertical-slice capability folders.');
  assert.equal(existsSync(join(serverDir, 'ai', 'routes.mjs')), true, 'ai/routes.mjs (the real Fastify-route AI capability entry point) should exist.');
});

test('every capability follows the same vertical-slice convention: a sibling folder under server/ with a routes.mjs entry point', () => {
  for (const dir of CAPABILITY_DIRS) {
    assert.equal(
      existsSync(join(serverDir, dir, 'routes.mjs')),
      true,
      `server/${dir}/routes.mjs should exist — every capability uses the same "routes.mjs" entry-point name, not "index.mjs"/"plugin.mjs"/a routes/ subfolder.`,
    );
  }
});

test('the old readJsonBody/sendJson transport helpers have no remaining callers', () => {
  const source = readFileSync(join(serverDir, 'specs', 'http-utils.mjs'), 'utf8');
  assert.ok(!/readJsonBody/.test(source), 'readJsonBody should have been removed once every route moved to Fastify\'s own body parsing.');
  assert.ok(!/sendJson/.test(source), 'sendJson should have been removed once every route moved to Fastify\'s own reply API.');
});

test('app.mjs only owns the lifecycle hook for the one genuinely shared resource it constructs (operationRuntime), never a preClose', () => {
  const appSource = readFileSync(join(serverDir, 'app.mjs'), 'utf8');
  assert.ok(
    !/addHook\s*\(\s*['"]preClose['"]/.test(appSource),
    'app.mjs registers a preClose hook — connection-draining/request-lifecycle concerns belong inside a capability\'s own routes.mjs, not the composition root.',
  );
  const onCloseMatches = appSource.match(/addHook\s*\(\s*['"]onClose['"]/g) || [];
  assert.equal(
    onCloseMatches.length,
    1,
    'app.mjs should register exactly one onClose hook — for the shared operationRuntime it constructs (see its own comment). Any other capability\'s shutdown belongs inside that capability\'s own routes.mjs.',
  );
});

test('app.mjs does not import or enumerate normal capabilities', () => {
  const appSource = readFileSync(join(serverDir, 'app.mjs'), 'utf8');
  for (const dir of CAPABILITY_DIRS) {
    // `operations/runtime.mjs` is the one sanctioned exception (the shared
    // operationRuntime factory, not a route entry point) — importing a
    // capability's own `routes.mjs` by name is exactly the "central
    // capability registry" this checks against.
    assert.ok(
      !new RegExp(`from\\s+['"]\\./${dir}/routes\\.mjs['"]`).test(appSource),
      `app.mjs imports './${dir}/routes.mjs' directly — capabilities must be discovered generically (see @fastify/autoload usage), not imported by name.`,
    );
  }
  assert.ok(
    /@fastify\/autoload/.test(appSource),
    'app.mjs should discover capability routes via @fastify/autoload (an established Fastify mechanism), not a custom route scanner or capability registry.',
  );
});

test('config is not used as a service locator for constructed feature-private dependencies', () => {
  // These are exactly the values app.mjs used to thread through `config`
  // before feature-private dependency construction moved into each
  // capability's own routes.mjs (as a local override option instead).
  const forbiddenPatterns = [
    /config\.ai\??\.service\b/,
    /config\.ai\??\.serviceFactory\b/,
    /config\.ai\??\.accessPolicy\b/,
    /config\.pullRequests\??\.provider\b/,
    /config\.specs\??\.actionExecutor\b/,
    /config\.operations\??\.operationRuntime\b/,
  ];
  const filesToCheck = [join(serverDir, 'app.mjs'), ...capabilityFiles];
  for (const file of filesToCheck) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(source),
        `${file} reads ${pattern} — config must carry configuration (paths, network/repository settings), not constructed service/provider/executor/runtime instances. Feature-level tests should override such a dependency as a capability's own local plugin option instead.`,
      );
    }
  }
});

