const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_UI_PORT = 4317;
const DEFAULT_API_PORT = 4318;

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got '${value}'.`);
  }
  return port;
}

function parseFlags(argv) {
  if (argv.length > 0 && argv.every((argument) => !argument.startsWith('--'))) {
    if (argv.length > 3) throw new Error('Dashboard accepts at most three positional values: host, port, api-port.');
    const [host, port, apiPort] = argv;
    return {
      ...(host ? { host } : {}),
      ...(port ? { port } : {}),
      ...(apiPort ? { 'api-port': apiPort } : {}),
    };
  }

  const result = {};
  const supported = new Set(['host', 'port', 'http-port', 'api-port', 'https-port']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown dashboard argument '${argument}'.`);

    const separator = argument.indexOf('=');
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    if (!supported.has(name)) throw new Error(`Unknown dashboard option '--${name}'.`);

    const value = separator === -1 ? argv[(index += 1)] : argument.slice(separator + 1);
    if (!value || value.startsWith('--')) throw new Error(`Dashboard option '--${name}' requires a value.`);
    result[name] = value;
  }

  return result;
}

export function dashboardNetworkConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
  const flags = parseFlags(argv);
  const host = String(flags.host || env.NEVO_DASHBOARD_HOST || DEFAULT_HOST).trim();
  if (!host || host.includes('://') || /[/?#]/.test(host)) {
    throw new Error(`Dashboard host must be an IP address or hostname without a protocol, got '${host}'.`);
  }

  // `--http-port` / NEVO_DASHBOARD_HTTP_PORT is an alias for `--port` /
  // NEVO_DASHBOARD_PORT — same meaning (the plain-HTTP port, or the only
  // port when no TLS cert is configured), added so it can read symmetrically
  // next to `--https-port`. Neither is deprecated; existing scripts using
  // `--port` keep working unchanged.
  const port = parsePort(
    flags['http-port'] ||
      flags.port ||
      env.NEVO_DASHBOARD_HTTP_PORT ||
      env.NEVO_DASHBOARD_PORT ||
      env.PORT ||
      DEFAULT_UI_PORT,
    'Dashboard port',
  );

  const rawHttpsPort = flags['https-port'] || env.NEVO_DASHBOARD_HTTPS_PORT;
  const explicitHttpsPort =
    rawHttpsPort !== undefined && rawHttpsPort !== null && rawHttpsPort !== ''
      ? parsePort(rawHttpsPort, 'Dashboard HTTPS port')
      : null;

  return {
    host,
    port,
    apiPort: parsePort(flags['api-port'] || env.NEVO_DASHBOARD_API_PORT || DEFAULT_API_PORT, 'Dashboard API port'),
    explicitHttpsPort,
    httpsPort: explicitHttpsPort,
  };
}

/**
 * Resolves and validates the HTTPS serving port when TLS is enabled.
 * Uses an explicitly configured HTTPS port when provided, or derives `port + 1`
 * as the standard convention. Enforces that the HTTP redirect port and HTTPS
 * serving port do not conflict.
 */
export function resolveHttpsPort({ port, explicitHttpsPort, httpsPort } = {}) {
  const explicit = explicitHttpsPort ?? httpsPort;
  const candidate = explicit ?? (port != null ? port + 1 : undefined);
  if (candidate == null) {
    throw new Error('Cannot resolve HTTPS port without a port or explicit HTTPS port.');
  }
  const resolvedPort = parsePort(candidate, 'Dashboard HTTPS port');
  if (resolvedPort === port) {
    throw new Error(
      `When TLS is active, HTTP redirect port (${port}) and HTTPS serving port (${resolvedPort}) must be different.`,
    );
  }
  return resolvedPort;
}

export { DEFAULT_API_PORT, DEFAULT_HOST, DEFAULT_UI_PORT };
