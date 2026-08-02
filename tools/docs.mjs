#!/usr/bin/env node
// tools/docs.mjs — documentation index and validation CLI
// Usage: node tools/docs.mjs <generate|validate|check|find>

import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

import {
  scanDocs, validateDocs, buildDocsIndexes, writeDocsIndexes, checkDocsIndexes, findDocs,
} from './docs/service.mjs';

// ── Command handlers ────────────────────────────────────────────────────────
// Plain functions, testable without touching process.argv or Commander.

function reportErrors(errors) {
  errors.forEach(e => console.error(e));
  process.exitCode = 1;
}

export function handleGenerate() {
  const docs = scanDocs();
  const errors = validateDocs(docs);
  if (errors.length) { reportErrors(errors); return; }
  writeDocsIndexes(buildDocsIndexes(docs));
  console.log('Generated: docs/index.generated.json');
  console.log('Generated: docs/index.generated.md');
}

export function handleValidate() {
  const docs = scanDocs();
  const errors = validateDocs(docs);
  if (errors.length) { reportErrors(errors); return; }
  console.log(`Validated ${docs.length} documents — no errors.`);
}

export function handleCheck() {
  const docs = scanDocs();
  const errors = validateDocs(docs);
  if (errors.length) { reportErrors(errors); return; }
  const problems = checkDocsIndexes(docs);
  if (problems.length) {
    problems.forEach(p => console.error(p));
    console.error('Run: node tools/docs.mjs generate');
    process.exitCode = 1;
    return;
  }
  console.log('Indexes are current.');
}

export function handleFind({ scope, type, format }) {
  const docs = scanDocs();
  const results = findDocs(docs, { scope, type });
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const doc of results) console.log(`${doc.id}  ${doc.file}`);
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
    .description('Find documents by scope and/or type')
    .option('--scope <scope>', 'filter by scope')
    .option('--type <type>', 'filter by document type')
    .option('--format <format>', 'output format: text or json', 'text')
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
