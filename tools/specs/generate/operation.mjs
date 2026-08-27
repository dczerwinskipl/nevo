import { validateSpecs } from '../validation.mjs';
import { buildSpecsIndexes, writeSpecsIndexes } from '../indexes.mjs';
import { CliError } from '../../lib/cli-errors.mjs';

/**
 * Application operation: rebuild the generated specs indexes.
 * Throws a structured error (one line per validation problem) instead of
 * writing to stderr/exitCode itself; returns the build summary on success.
 */
export function generateSpecsIndexes() {
  const errors = validateSpecs();
  if (errors.length) {
    throw new CliError(errors.join('\n'));
  }
  const built = buildSpecsIndexes();
  writeSpecsIndexes(built);
  return built;
}
