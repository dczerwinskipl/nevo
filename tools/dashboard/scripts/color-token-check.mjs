import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// The original 39 `:root` color custom-property names removed by the
// cleanup-and-token-removal task. Not derivable from the current index.css (they no
// longer exist there) — this is the maintained list the CSS-file legacy-reference
// check needs, per areas/cleanup-and-enforcement.md.
export const LEGACY_CSS_VARIABLE_NAMES = [
  'background',
  'surface',
  'surface-raised',
  'surface-hover',
  'border',
  'border-strong',
  'foreground',
  'muted',
  'muted-strong',
  'accent',
  'accent-strong',
  'accent-foreground',
  'accent-muted',
  'accent-border',
  'success',
  'success-strong',
  'success-muted',
  'success-border',
  'warning',
  'warning-strong',
  'warning-muted',
  'warning-border',
  'danger',
  'danger-strong',
  'danger-muted',
  'danger-border',
  'info',
  'info-strong',
  'info-muted',
  'info-border',
  'lane-new',
  'lane-design',
  'lane-ready',
  'lane-implementation',
  'lane-review',
  'lane-done',
  'lane-danger',
  'cat-1',
  'cat-2',
];

const COLOR_UTILITY_PREFIXES = ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke', 'caret'];

const DEFAULT_PALETTE_FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

/** Extracts every declared `--color-*` custom property name from an index.css-shaped `@theme` source. */
export function extractDeclaredColorTokens(cssSource) {
  const names = new Set();
  const re = /--color-[\w-]+(?=\s*:)/g;
  let match;
  while ((match = re.exec(cssSource))) {
    names.add(match[0]);
  }
  return names;
}

function walk(rootDir, extensions, exclude) {
  const results = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (exclude(full)) continue;
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (extensions.includes(extname(full))) {
        results.push(full);
      }
    }
  }
  return results;
}

function defaultExclude(fullPath) {
  const normalized = fullPath.replace(/\\/g, '/');
  return (
    normalized.includes('/tests/') ||
    normalized.includes('/__fixtures__/') ||
    normalized.includes('/node_modules/') ||
    /\.generated\.(ts|tsx|css|json)$/.test(normalized) ||
    normalized.endsWith('routeTree.gen.ts')
  );
}

/**
 * Scans one file's already-read source text for regressions into the pre-migration color
 * architecture. `relPath`'s extension decides TS/TSX vs. CSS rules. Returns a list of
 * `{ file, line, rule, snippet }` violations — empty when clean. Exported directly so
 * fixture tests can exercise the detection rules without touching disk.
 */
export function checkContent(relPath, content, { declaredColorTokens } = {}) {
  const violations = [];
  const lines = content.split('\n');
  const isCss = extname(relPath) === '.css';
  const normalizedRelPath = relPath.replace(/\\/g, '/');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const record = (rule, snippet) =>
      violations.push({ file: normalizedRelPath, line: lineNo, rule, snippet: snippet.trim() });

    if (isCss) {
      for (const name of LEGACY_CSS_VARIABLE_NAMES) {
        const re = new RegExp(`var\\(--${name}\\)`);
        if (re.test(line)) record('legacy-css-variable', line);
      }
      return;
    }

    // 1. Color-bearing arbitrary-value utilities: bg-[var(--...)], ring-[var(--...)], etc.
    const arbitraryVarUtility = new RegExp(`\\b(${COLOR_UTILITY_PREFIXES.join('|')})-\\[var\\(--`);
    if (arbitraryVarUtility.test(line)) record('arbitrary-value-color-utility', line);

    // 2. Direct Tailwind default-palette utilities (bg-white, text-blue-500, etc.)
    const defaultPalette = new RegExp(
      `\\b(${COLOR_UTILITY_PREFIXES.join('|')})-(white|black|${DEFAULT_PALETTE_FAMILIES.join('|')})(-\\d{2,3})?\\b`,
    );
    if (defaultPalette.test(line)) record('default-palette-utility', line);

    // 3. Undeclared `--color-*` variable references.
    if (declaredColorTokens) {
      const colorVarRefs = line.match(/var\(--color-[\w-]+\)/g) || [];
      for (const ref of colorVarRefs) {
        const name = ref.slice('var('.length, -1);
        if (!declaredColorTokens.has(name)) record('undeclared-color-variable', line);
      }
    }

    // 4. Component-local color-mix(...) recipes (allowed only inside index.css's selector-oriented exception).
    if (line.includes('color-mix(')) record('component-local-color-mix', line);

    // 5. Interpolated Tailwind class construction, e.g. `text-status-${tone}`.
    const interpolated = new RegExp(`(${COLOR_UTILITY_PREFIXES.join('|')})-[\\w-]*\\$\\{`);
    if (interpolated.test(line)) record('interpolated-tailwind-class', line);

    // 6. `text-accent-solid` (or equivalent fill-only-as-text misuse), D4.
    if (line.includes('text-accent-solid')) record('accent-solid-as-text', line);
  });

  return violations;
}

/**
 * Scans `tools/dashboard/ui` (TS/TSX + CSS) for regressions into the pre-migration color
 * architecture. Returns a list of `{ file, line, rule, snippet }` violations — empty when clean.
 */
export function checkColorTokenArchitecture(rootDir, { declaredColorTokens } = {}) {
  const violations = [];
  const files = walk(rootDir, ['.ts', '.tsx', '.css'], defaultExclude);

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const relPath = relative(rootDir, file);
    violations.push(...checkContent(relPath, content, { declaredColorTokens }));
  }

  return violations;
}
