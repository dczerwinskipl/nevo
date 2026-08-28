import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-level regression guards: prevent the dashboard server from quietly
// regressing back to a handwritten HTTP router hidden behind Fastify (a
// central `fastify.all(...)` + `request.method` switch, or a wildcard +
// `reply.hijack()` + a second internal regex-based URL router for AI).
// These are deliberately simple text checks, not behavioral tests — the
// other suites already prove the observable HTTP contract; this one proves
// the *architecture* doesn't drift back.

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');

function listRouteFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRouteFiles(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

const routeFiles = listRouteFiles(join(serverDir, 'routes'));

// Files where `reply.hijack()`/`reply.raw` is legitimate: genuine SSE
// streaming boundaries, not a substitute for Fastify's own routing.
const KNOWN_SSE_FILES = new Set([
  join(serverDir, 'routes', 'events.mjs'),
  join(serverDir, 'routes', 'operations.mjs'),
  join(serverDir, 'routes', 'ai', 'events.mjs'),
]);

test('no dashboard route module uses fastify.all(...) as its normal routing pattern', () => {
  for (const file of routeFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/\bfastify\.all\s*\(/.test(source) && !/\bscoped\.all\s*\(/.test(source),
      `${file} still registers routes via .all(...) — use a verb-specific registration (get/post/patch/delete) plus registerMethodFallback for the 405 contract instead.`,
    );
  }
});

test('no dashboard route module hand-dispatches on request.method after Fastify has already matched the route', () => {
  for (const file of routeFiles) {
    const source = readFileSync(file, 'utf8');
    assert.ok(
      !/if\s*\(\s*request\.method\s*!==/.test(source),
      `${file} still branches on request.method inside a route handler — Fastify's own verb-specific registration should make this unnecessary (the only sanctioned exception is http-compat.mjs's own method-fallback helper).`,
    );
  }
});

test('reply.hijack()/reply.raw is confined to genuine SSE streaming boundaries', () => {
  for (const file of routeFiles) {
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
  const aiDir = join(serverDir, 'routes', 'ai');
  for (const file of listRouteFiles(aiDir)) {
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
  assert.equal(existsSync(join(serverDir, 'routes', 'ai.mjs')), false, 'routes/ai.mjs (the old wildcard+hijack+raw AI adapter) should have been removed in favor of routes/ai/index.mjs.');
  assert.equal(existsSync(join(serverDir, 'routes', 'ai', 'index.mjs')), true, 'routes/ai/index.mjs (the real Fastify-route AI capability entry point) should exist.');
});

test('the old readJsonBody/sendJson transport helpers have no remaining callers', () => {
  const source = readFileSync(join(serverDir, 'http-utils.mjs'), 'utf8');
  assert.ok(!/readJsonBody/.test(source), 'readJsonBody should have been removed once every route moved to Fastify\'s own body parsing.');
  assert.ok(!/sendJson/.test(source), 'sendJson should have been removed once every route moved to Fastify\'s own reply API.');
});

test('capability route modules own their own lifecycle hooks, not the app-level composition root', () => {
  const appSource = readFileSync(join(serverDir, 'app.mjs'), 'utf8');
  assert.ok(
    !/addHook\s*\(\s*['"]preClose['"]/.test(appSource) && !/addHook\s*\(\s*['"]onClose['"]/.test(appSource),
    'app.mjs registers a lifecycle hook directly — shutdown/cleanup logic for a capability\'s own resources (SSE connections, a runtime, a service) belongs inside that capability\'s own routes/*.mjs register function, not the composition root.',
  );
});
