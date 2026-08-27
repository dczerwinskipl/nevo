// YAML access, backed by the `yaml` package — structural parsing and structural
// updates instead of a hand-rolled parser or regex edits. Kept close to the two
// actual use cases in this repo: whole-file YAML (change.yaml) and Markdown
// front matter (task/review/doc files).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, parseDocument } from 'yaml';
import { CliError } from './cli-errors.mjs';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * YAML folded (`>`) and literal (`|`) block scalars keep a trailing newline by
 * default ("clip" chomping) — correct per spec, but this repo only ever uses
 * them to author single-line display values (e.g. a `summary: >` paragraph),
 * so a bare trailing newline in the parsed value would just be noise carried
 * into generated indexes. Trim it after parsing rather than asking every doc
 * author to remember `>-` strip chomping.
 */
function trimTrailingNewlines(value) {
  if (typeof value === 'string') return value.replace(/\n+$/, '');
  if (Array.isArray(value)) return value.map(trimTrailingNewlines);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimTrailingNewlines(v)]));
  }
  return value;
}

/** Parse a YAML string. Throws CliError on invalid YAML. */
export function parseYamlString(raw, label = 'YAML') {
  try {
    return trimTrailingNewlines(parse(raw) ?? {});
  } catch (err) {
    throw new CliError(`Invalid YAML in ${label}: ${err.message}`);
  }
}

/** Parse a whole file as YAML (e.g. change.yaml). Throws CliError with the file path on invalid YAML. */
export function parseYamlFile(path) {
  const raw = readFileSync(path, 'utf8');
  return parseYamlString(raw, path);
}

/** Extract the raw text of a `---`-delimited front matter block, or null if there isn't one. */
export function extractFrontMatter(content) {
  const match = content.match(FRONT_MATTER_RE);
  return match ? match[1] : null;
}

/**
 * Parse the front matter block of a Markdown document's content. Returns `null`
 * if there is no `---` block at all — distinct from an empty-but-present block,
 * which parses to `{}`. Callers that want a single "nothing here" default should
 * use `parseFrontMatterFile` instead.
 */
export function parseFrontMatter(content, path) {
  const raw = extractFrontMatter(content);
  if (raw === null) return null;
  try {
    return trimTrailingNewlines(parse(raw) ?? {});
  } catch (err) {
    throw new CliError(`Invalid YAML front matter in ${path}: ${err.message}`);
  }
}

/** Parse the front matter of a Markdown file by path. Returns {} if the file or front matter is missing. */
export function parseFrontMatterFile(path) {
  if (!existsSync(path)) return {};
  return parseFrontMatter(readFileSync(path, 'utf8'), path) ?? {};
}

/**
 * Structurally update a YAML file: parse it into a mutable Document, let
 * `mutate(doc)` edit specific fields in place, then write the result back.
 * Preserves comments and formatting for everything `mutate` doesn't touch —
 * no regex line replacement.
 */
export function updateYamlFile(path, mutate) {
  const raw = readFileSync(path, 'utf8');
  let doc;
  try {
    doc = parseDocument(raw);
  } catch (err) {
    throw new CliError(`Invalid YAML in ${path}: ${err.message}`);
  }
  mutate(doc);
  writeFileSync(path, String(doc));
}
