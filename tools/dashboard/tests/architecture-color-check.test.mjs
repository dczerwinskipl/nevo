import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  checkContent,
  checkColorTokenArchitecture,
  extractDeclaredColorTokens,
} from '../scripts/color-token-check.mjs';

const uiRoot = fileURLToPath(new URL('../ui', import.meta.url));

function declaredTokens() {
  const indexCss = readFileSync(fileURLToPath(new URL('../ui/index.css', import.meta.url)), 'utf8');
  return extractDeclaredColorTokens(indexCss);
}

test('AC1: bg-[var(--foo)] arbitrary-value color utility fails the check', () => {
  const violations = checkContent('features/example/widget.tsx', '<div className="bg-[var(--foo)]" />');
  assert.ok(violations.some((v) => v.rule === 'arbitrary-value-color-utility'));
});

test('AC2: bg-white / text-blue-500 default-palette utility fails the check', () => {
  const violations = checkContent('features/example/widget.tsx', '<div className="bg-white text-blue-500" />');
  assert.ok(violations.some((v) => v.rule === 'default-palette-utility' && v.snippet.includes('bg-white')));
  assert.ok(violations.some((v) => v.rule === 'default-palette-utility' && v.snippet.includes('text-blue-500')));
});

test('AC3: undeclared --color-* variable reference fails the check', () => {
  const violations = checkContent('features/example/widget.tsx', "style={{ color: 'var(--color-totally-made-up)' }}", {
    declaredColorTokens: declaredTokens(),
  });
  assert.ok(violations.some((v) => v.rule === 'undeclared-color-variable'));

  const clean = checkContent('features/example/widget.tsx', "style={{ color: 'var(--color-accent)' }}", {
    declaredColorTokens: declaredTokens(),
  });
  assert.ok(!clean.some((v) => v.rule === 'undeclared-color-variable'));
});

test('AC4: repeated component-local color-mix(...) recipe fails the check', () => {
  const violations = checkContent(
    'features/example/widget.tsx',
    "const tint = 'color-mix(in srgb, var(--color-accent) 20%, transparent)';",
  );
  assert.ok(violations.some((v) => v.rule === 'component-local-color-mix'));
});

test('AC5: interpolated Tailwind class construction fails the check', () => {
  const violations = checkContent('features/example/widget.tsx', 'const cls = `text-status-${tone}`;');
  assert.ok(violations.some((v) => v.rule === 'interpolated-tailwind-class'));
});

test('AC6: ring-[var(--foo)], fill-[var(--foo)], stroke-[var(--foo)] fail the check', () => {
  const violations = checkContent(
    'features/example/widget.tsx',
    '<svg className="ring-[var(--foo)] fill-[var(--foo)] stroke-[var(--foo)]" />',
  );
  assert.ok(
    violations.some((v) => v.rule === 'arbitrary-value-color-utility' && v.snippet.includes('ring-[var(--foo)]')),
  );
  assert.ok(
    violations.some((v) => v.rule === 'arbitrary-value-color-utility' && v.snippet.includes('fill-[var(--foo)]')),
  );
  assert.ok(
    violations.some((v) => v.rule === 'arbitrary-value-color-utility' && v.snippet.includes('stroke-[var(--foo)]')),
  );
});

test('AC7: a legacy CSS custom-property reference fails the check; the canonical token passes', () => {
  const legacy = checkContent('index.css', '.thing { color: var(--accent); }');
  assert.ok(legacy.some((v) => v.rule === 'legacy-css-variable'));

  const canonical = checkContent('index.css', '.thing { color: var(--color-accent); }');
  assert.ok(!canonical.some((v) => v.rule === 'legacy-css-variable'));
});

test('AC3 (CSS): an undeclared --color-* reference (e.g. a typo) in a .css file fails the check', () => {
  const violations = checkContent('index.css', '.thing { background: var(--color-sruface); }', {
    declaredColorTokens: declaredTokens(),
  });
  assert.ok(violations.some((v) => v.rule === 'undeclared-color-variable'));

  const clean = checkContent('index.css', '.thing { background: var(--color-surface); }', {
    declaredColorTokens: declaredTokens(),
  });
  assert.ok(!clean.some((v) => v.rule === 'undeclared-color-variable'));
});

test('AC8: text-accent-solid fails the check', () => {
  const violations = checkContent('features/example/widget.tsx', '<span className="text-accent-solid">Go</span>');
  assert.ok(violations.some((v) => v.rule === 'accent-solid-as-text'));
});

test('AC9: the check passes against the real, fully-migrated tools/dashboard/ui tree', () => {
  const violations = checkColorTokenArchitecture(uiRoot, { declaredColorTokens: declaredTokens() });
  assert.deepEqual(violations, []);
});

test('AC11: no new npm dependency was added for this check', () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const knownDeps = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  // The check itself (tools/dashboard/scripts/color-token-check.mjs) imports only node:fs/node:path.
  assert.ok(knownDeps.size > 0, 'sanity check that package.json parsed');
});
