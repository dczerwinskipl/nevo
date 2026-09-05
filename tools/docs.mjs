#!/usr/bin/env node
// tools/docs.mjs — documentation index and validation CLI
// Usage: node tools/docs.mjs <generate|validate|check|find>

import { Command, Option } from 'commander';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

import {
  scanDocs, validateDocs, buildDocsIndexes, writeDocsIndexes, checkDocsIndexes, findDocs,
} from './docs/service.mjs';
import { readUtf8, writeUtf8, resolveWithinBase } from './lib/fs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Command handlers ────────────────────────────────────────────────────────
// Plain functions, testable without touching process.argv or Commander.

function reportErrors(errors) {
  errors.forEach(e => console.error(e));
  process.exitCode = 1;
}

// ── Machine-readable routing table (D12, area context-and-validation-hardening,
// task 05) ───────────────────────────────────────────────────────────────────
//
// `docs/ai/task-routing.md` and `docs/ai/change-impact-map.md` each carry a
// fixed-column `rule_id | path_glob | doc_ref` table under a `## Routing
// table` heading, in addition to their existing free-form prose (the table is
// a supplement for machine matching, not a replacement for the human-facing
// content). `docs/routing.generated.json` — generated from these two tables
// — is the only thing a context-completeness check may read; it must never
// re-parse this Markdown at check time (that re-parse happens here, once, at
// validate/generate/check time only).

export const TASK_ROUTING_FILE = join(ROOT, 'docs', 'ai', 'task-routing.md');
export const CHANGE_IMPACT_MAP_FILE = join(ROOT, 'docs', 'ai', 'change-impact-map.md');
export const ROUTING_INDEX_FILE = join(ROOT, 'docs', 'routing.generated.json');
const ROUTING_HEADING = '## Routing table';

/**
 * Parse one file's `## Routing table` section into `{rule_id, path_glob,
 * doc_ref, source}` rows. Pure — takes already-read content, not a path, so
 * tests can exercise it without touching disk. `source` is the file's
 * repo-relative path, carried along for error messages and for `docs_ref`
 * cross-file duplicate reporting.
 */
export function parseRoutingTable(content, source) {
  const rules = [];
  const errors = [];
  const lines = content.split('\n');

  const headingIdx = lines.findIndex(l => l.trim() === ROUTING_HEADING);
  if (headingIdx === -1) {
    errors.push(`${source}: missing '${ROUTING_HEADING}' section`);
    return { rules, errors };
  }

  // Prose is allowed between the heading and its table (e.g. an explanatory
  // paragraph) — but stop at the next heading rather than scanning past it,
  // so a later, unrelated table elsewhere in the file is never mistaken for
  // this section's own.
  let i = headingIdx + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (lines[i].trim().startsWith('#')) {
      errors.push(`${source}: '${ROUTING_HEADING}' section has no table before the next heading`);
      return { rules, errors };
    }
    i++;
  }
  if (i >= lines.length) {
    errors.push(`${source}: '${ROUTING_HEADING}' section has no table`);
    return { rules, errors };
  }

  const header = lines[i].split('|').slice(1, -1).map(c => c.trim().toLowerCase());
  if (header.length !== 3 || header[0] !== 'rule_id' || header[1] !== 'path_glob' || header[2] !== 'doc_ref') {
    errors.push(`${source}: routing table header must be exactly 'rule_id | path_glob | doc_ref' (got '${lines[i].trim()}')`);
    return { rules, errors };
  }

  // The separator row is validated explicitly, not assumed present (PR
  // review packet 05C, Problem 1) — a missing/malformed one would otherwise
  // silently skip the table's first real data row (mistaken for the
  // separator) or accept malformed input.
  const separatorLine = lines[i + 1];
  const separatorCells = (separatorLine || '').split('|').slice(1, -1).map(c => c.trim());
  const isValidSeparator = separatorCells.length === 3 && separatorCells.every(c => /^:?-+:?$/.test(c));
  if (!isValidSeparator) {
    errors.push(
      `${source}: routing table header must be followed by a valid separator row ` +
      `(e.g. '|---|---|---|'), got '${(separatorLine || '').trim()}'`
    );
    return { rules, errors };
  }
  i += 2; // header row + validated separator row

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim().startsWith('|')) break; // table ended
    const cells = raw.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length !== 3 || cells.some(c => !c)) {
      errors.push(`${source}: malformed routing table row: '${raw.trim()}'`);
      continue;
    }
    const [rule_id, path_glob, doc_ref] = cells;
    rules.push({ rule_id, path_glob, doc_ref, source });
  }

  return { rules, errors };
}

/**
 * Validate the combined rule set from every routing-table source: each row
 * well-formed (from `parseRoutingTable`), `rule_id` unique across every
 * source file combined, and `doc_ref` resolves to a real file. Pure —
 * `sources` is `[{file, content}]`, already read.
 */
export function validateRoutingTables(sources) {
  const errors = [];
  const allRules = [];
  for (const { file, content } of sources) {
    const { rules, errors: parseErrors } = parseRoutingTable(content, file);
    errors.push(...parseErrors);
    allRules.push(...rules);
  }

  const seen = new Map();
  for (const rule of allRules) {
    if (seen.has(rule.rule_id)) {
      errors.push(`${rule.source}: duplicate rule_id '${rule.rule_id}' (also in ${seen.get(rule.rule_id)})`);
    } else {
      seen.set(rule.rule_id, rule.source);
    }
    // Contained and normalized before checking existence (PR review packet
    // 05C, Problem 2) — a bare `join` would follow `../` traversal or an
    // absolute path outside the repository; resolveWithinBase rejects both.
    let resolvedDocRef;
    try {
      resolvedDocRef = resolveWithinBase(ROOT, rule.doc_ref);
    } catch {
      errors.push(`${rule.source}: routing rule '${rule.rule_id}' has a doc_ref '${rule.doc_ref}' that escapes the repository`);
      continue;
    }
    if (!existsSync(resolvedDocRef)) {
      errors.push(`${rule.source}: routing rule '${rule.rule_id}' references missing doc_ref '${rule.doc_ref}'`);
    }
  }

  return { rules: allRules, errors };
}

function readRoutingSources() {
  return [TASK_ROUTING_FILE, CHANGE_IMPACT_MAP_FILE].map(f => ({
    file: relative(ROOT, f).replace(/\\/g, '/'),
    content: readUtf8(f),
  }));
}

/** Build the expected generated routing index in memory (deterministic — no timestamp). */
export function buildRoutingIndex(rules) {
  const sorted = rules
    .map(({ rule_id, path_glob, doc_ref, source }) => ({ rule_id, path_glob, doc_ref, source }))
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  return { rules: sorted };
}

function writeRoutingIndex(built) {
  writeUtf8(ROUTING_INDEX_FILE, JSON.stringify({ generated: new Date().toISOString(), ...built }, null, 2));
}

/**
 * Compare an on-disk generated index against the freshly-built one, ignoring
 * the timestamp. `indexFile` defaults to the real generated file; tests pass
 * a temp path so they never touch repository state.
 */
export function checkRoutingIndex(built, indexFile = ROUTING_INDEX_FILE) {
  if (!existsSync(indexFile)) return ['missing: docs/routing.generated.json'];
  const existing = JSON.parse(readUtf8(indexFile));
  if (JSON.stringify(existing.rules) !== JSON.stringify(built.rules)) {
    return ['stale: docs/routing.generated.json'];
  }
  return [];
}

export function handleGenerate() {
  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  const { rules, errors: routingErrors } = validateRoutingTables(readRoutingSources());
  const errors = [...docErrors, ...routingErrors];
  if (errors.length) { reportErrors(errors); return; }
  writeDocsIndexes(buildDocsIndexes(docs));
  console.log('Generated: docs/index.generated.json');
  console.log('Generated: docs/index.generated.md');
  writeRoutingIndex(buildRoutingIndex(rules));
  console.log('Generated: docs/routing.generated.json');
}

export function handleValidate() {
  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  const { errors: routingErrors } = validateRoutingTables(readRoutingSources());
  const errors = [...docErrors, ...routingErrors];
  if (errors.length) { reportErrors(errors); return; }
  console.log(`Validated ${docs.length} documents — no errors.`);
}

export function handleCheck() {
  const docs = scanDocs();
  const docErrors = validateDocs(docs);
  const { rules, errors: routingErrors } = validateRoutingTables(readRoutingSources());
  const errors = [...docErrors, ...routingErrors];
  if (errors.length) { reportErrors(errors); return; }
  const problems = [...checkDocsIndexes(docs), ...checkRoutingIndex(buildRoutingIndex(rules))];
  if (problems.length) {
    problems.forEach(p => console.error(p));
    console.error('Run: node tools/docs.mjs generate');
    process.exitCode = 1;
    return;
  }
  console.log('Indexes are current.');
}

export function handleFind({ query, path, scope, type, format }) {
  const docs = scanDocs();
  let results;
  try {
    results = findDocs(docs, { query, path, scope, type });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const doc of results) {
      const parts = [];
      if (doc.match_reason) parts.push(doc.match_reason);
      if (doc.matched_terms && doc.matched_terms.length > 0) {
        parts.push(`matched [${doc.matched_terms.join(', ')}] in ${doc.matched_fields.join(', ')}`);
      }
      const explanation = parts.length > 0 ? `  (${parts.join('; ')})` : '';
      console.log(`${doc.id} — "${doc.title}"  ${doc.file}${explanation}`);
    }
  }
}

// ── CLI wiring ───────────────────────────────────────────────────────────────

export function buildProgram() {
  const program = new Command();
  program
    .name('node tools/docs.mjs')
    .description('Documentation index and validation CLI')
    .exitOverride();

  program.command('generate')
    .description('Rebuild docs/index.generated.*')
    .action(handleGenerate);

  program.command('validate')
    .description('Validate front matter across docs/')
    .action(handleValidate);

  program.command('check')
    .description('Validate + verify the generated index is current')
    .action(handleCheck);

  program.command('find')
    .description('Find documents by query, path, scope, and/or type')
    .option('--query <query>', 'search across id, title, summary, read_when, file, and related')
    .option('--path <path>', 'find documents governing a file or directory path via routing rules')
    .option('--scope <scope>', 'filter by scope')
    .option('--type <type>', 'filter by document type')
    .addOption(new Option('--format <format>', 'output format: text or json').choices(['text', 'json']).default('text'))
    .action(handleFind);

  return program;
}

async function runCli() {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('commander.')) {
      process.exitCode = typeof error.exitCode === 'number' ? error.exitCode : 1;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Only run the CLI when this file is executed directly, not when imported by tests.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  await runCli();
}
