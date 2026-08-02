// Error type for expected, user-facing CLI failures (invalid usage, invalid YAML,
// invalid workflow transitions, missing files, path-safety violations, ...).
// The top-level CLI boundary in tools/specs.mjs and tools/docs.mjs prints
// CliError messages without a stack trace; anything else is a programmer error
// and is allowed to surface with its full stack so it stays diagnosable.

export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}
