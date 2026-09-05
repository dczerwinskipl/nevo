import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');

function listFiles(dir, extensions = ['.ts', '.tsx']) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(full, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  const importExportRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importExportRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

test('1. Sibling feature isolation: features/** has zero imports from other features', () => {
  const featuresDir = join(uiDir, 'features');
  const featureDirs = readdirSync(featuresDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const violations = [];

  for (const featureName of featureDirs) {
    const featFiles = listFiles(join(featuresDir, featureName));
    for (const file of featFiles) {
      const source = readFileSync(file, 'utf8');
      const specifiers = extractImportSpecifiers(source);

      for (const specifier of specifiers) {
        for (const otherFeature of featureDirs) {
          if (otherFeature === featureName) continue;
          if (specifier === `@/features/${otherFeature}` || specifier.startsWith(`@/features/${otherFeature}/`)) {
            violations.push({
              file: relative(uiDir, file),
              specifier,
              reason: `Feature '${featureName}' directly imports sibling feature '${otherFeature}'`,
            });
          }
        }

        if (specifier.startsWith('.')) {
          const fileDir = dirname(file);
          const resolvedPath = join(fileDir, specifier);
          const relToFeatures = relative(featuresDir, resolvedPath);
          if (!relToFeatures.startsWith('..')) {
            const targetFeature = relToFeatures.split(/[\/\\]/)[0];
            if (targetFeature && targetFeature !== featureName && featureDirs.includes(targetFeature)) {
              violations.push({
                file: relative(uiDir, file),
                specifier,
                reason: `Feature '${featureName}' relatively imports sibling feature '${targetFeature}'`,
              });
            }
          }
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Sibling feature violations found:\n${JSON.stringify(violations, null, 2)}`);
});

test('2. Shared layer purity: shared/** never imports from features, screens, routes, or app', () => {
  const sharedDir = join(uiDir, 'shared');
  const sharedFiles = listFiles(sharedDir);
  const violations = [];

  for (const file of sharedFiles) {
    const source = readFileSync(file, 'utf8');
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      if (
        specifier.startsWith('@/features') ||
        specifier.startsWith('@/screens') ||
        specifier.startsWith('@/routes') ||
        specifier.startsWith('@/app')
      ) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'shared layer must not depend on higher layers (features, screens, routes, app)',
        });
      }

      if (specifier.startsWith('.')) {
        const fileDir = dirname(file);
        const resolvedPath = join(fileDir, specifier);
        const relToShared = relative(sharedDir, resolvedPath);
        if (relToShared.startsWith('..')) {
          violations.push({
            file: relative(uiDir, file),
            specifier,
            reason: 'shared layer relative import escapes shared directory',
          });
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Shared layer boundary violations found:\n${JSON.stringify(violations, null, 2)}`);
});

test('3. Screen layer decoupling: screens/** never imports from routes', () => {
  const screensDir = join(uiDir, 'screens');
  const screenFiles = listFiles(screensDir);
  const violations = [];

  for (const file of screenFiles) {
    const source = readFileSync(file, 'utf8');
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      if (specifier.startsWith('@/routes')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'screens layer must not depend on routes layer',
        });
      }

      if (specifier.startsWith('.')) {
        const fileDir = dirname(file);
        const resolvedPath = join(fileDir, specifier);
        const relToUi = relative(uiDir, resolvedPath);
        if (relToUi.startsWith('routes')) {
          violations.push({
            file: relative(uiDir, file),
            specifier,
            reason: 'screens layer relative import references routes',
          });
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Screens layer boundary violations found:\n${JSON.stringify(violations, null, 2)}`);
});

test('4. Route layer boundaries: routes/** delegates cleanly without importing app internals', () => {
  const routesDir = join(uiDir, 'routes');
  const routeFiles = listFiles(routesDir);
  const violations = [];

  for (const file of routeFiles) {
    const source = readFileSync(file, 'utf8');
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      // Routes must not import application bootstrap internals
      if (specifier.startsWith('@/app') || specifier.includes('/app/')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'route file must not import application bootstrap internals (@/app)',
        });
      }

      // Routes must not reach outside the frontend into server or config infrastructure
      if (specifier.includes('server/') || specifier.includes('config/')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'route file must not import server or infrastructure modules',
        });
      }

      // Feature imports in routes: only top-level single-feature page views are permitted
      if (specifier.startsWith('@/features/')) {
        const isPermittedPage = specifier.endsWith('-page') || specifier.includes('/list/');
        if (!isPermittedPage) {
          violations.push({
            file: relative(uiDir, file),
            specifier,
            reason: 'route file may only import top-level feature pages, not deep feature internals',
          });
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Route boundary violations found:\n${JSON.stringify(violations, null, 2)}`);
});

test('5. Deprecated paths and compatibility aliases are completely eliminated', () => {
  const allUiFiles = listFiles(uiDir);
  const violations = [];

  const legacyAliases = [
    'ActiveSpecificationsRoute',
    'ArchiveSpecificationsRoute',
    'SpecificationRoute',
    'AgentSessionRoute',
    'ActiveSpecificationsScreen',
    'ArchiveSpecificationsScreen',
  ];

  for (const file of allUiFiles) {
    const source = readFileSync(file, 'utf8');
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      if (specifier.startsWith('@/components')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'Legacy alias @/components has been deleted. Use @/shared/ui instead.',
        });
      }
      if (specifier === '@/lib/utils' || specifier.startsWith('@/lib')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'Legacy alias @/lib has been deleted. Use @/shared/lib/utils instead.',
        });
      }
      if (specifier.includes('overview-panel')) {
        violations.push({
          file: relative(uiDir, file),
          specifier,
          reason: 'overview-panel was decomposed into screens/specification-detail/specification-overview.tsx.',
        });
      }
    }

    // Check removed compatibility alias identifiers in code (excluding comments)
    for (const alias of legacyAliases) {
      const aliasRegex = new RegExp(`\\b${alias}\\b`);
      // Exclude simple comment references if line starts with // or *
      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
        if (aliasRegex.test(line)) {
          violations.push({
            file: relative(uiDir, file),
            line: i + 1,
            alias,
            reason: `Legacy route/screen alias '${alias}' must not be used in code.`,
          });
        }
      }
    }

    // Check fake SpecificationSummary placeholder
    if (/\{\}\s+as\s+SpecificationSummary/.test(source)) {
      violations.push({
        file: relative(uiDir, file),
        reason: 'Zero occurrences of "{} as SpecificationSummary" allowed. Use separate loaded content component.',
      });
    }
  }

  assert.deepEqual(violations, [], `Deprecated import/alias violations found:\n${JSON.stringify(violations, null, 2)}`);
});

test('6. Single-file directory flattening: pull-requests panel is flattened', () => {
  const oldPanelDir = join(uiDir, 'features', 'pull-requests', 'panel');
  assert.equal(existsSync(oldPanelDir), false, 'features/pull-requests/panel directory must be removed');

  const newPanelFile = join(uiDir, 'features', 'pull-requests', 'pull-requests-panel.tsx');
  assert.equal(existsSync(newPanelFile), true, 'features/pull-requests/pull-requests-panel.tsx must exist');
});

test('7. Screen locality: specification-console directory houses console layout and create dialog', () => {
  const oldTopLevelLayout = join(uiDir, 'screens', 'specification-console-layout.tsx');
  assert.equal(
    existsSync(oldTopLevelLayout),
    false,
    'screens/specification-console-layout.tsx must be moved under screens/specification-console/',
  );

  const consoleLayout = join(uiDir, 'screens', 'specification-console', 'specification-console-layout.tsx');
  assert.equal(
    existsSync(consoleLayout),
    true,
    'screens/specification-console/specification-console-layout.tsx must exist',
  );

  const createDialog = join(
    uiDir,
    'screens',
    'specification-console',
    'create-specification',
    'create-specification-dialog.tsx',
  );
  assert.equal(
    existsSync(createDialog),
    true,
    'create-specification dialog must live under screens/specification-console/create-specification',
  );
});

test('8. Canonical tab projection: SpecificationDetailContent imports computeVisibleTabs with no duplicate screen definition', () => {
  const contentFile = join(uiDir, 'screens', 'specification-detail', 'specification-detail-content.tsx');
  assert.equal(existsSync(contentFile), true, 'specification-detail-content.tsx must exist');
  const source = readFileSync(contentFile, 'utf-8');

  assert.ok(
    source.includes('@/features/specifications/detail/documentation-projection') &&
      source.includes('computeVisibleTabs'),
    'SpecificationDetailContent must import computeVisibleTabs from documentation-projection',
  );

  assert.equal(
    /function\s+computeVisibleTabs/.test(source),
    false,
    'SpecificationDetailContent must not define a duplicate local computeVisibleTabs',
  );
});
