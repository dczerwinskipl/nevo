import { validateSpecs } from '../validation.mjs';
import { checkSpecsIndexes } from '../indexes.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: validate specs, then confirm the generated indexes
 * are current. Throws a structured error (validation/staleness problems,
 * one per line) instead of writing to stderr/exitCode itself.
 */
export function checkSpecs() {
  const errors = validateSpecs();
  if (errors.length) {
    throw new CliError(errors.join('\n'));
  }
  const problems = checkSpecsIndexes();
  if (problems.length) {
    throw new CliError([...problems, 'Run: node tools/specs.mjs generate'].join('\n'));
  }
  return { ok: true };
}
