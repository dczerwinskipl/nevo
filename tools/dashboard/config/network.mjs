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
  if (argv.length > 0 && argv.every(argument => !argument.startsWith('--'))) {
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

    const value = separator === -1 ? argv[index += 1] : argument.slice(separator + 1);
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

  return {
    host,
    port,
    apiPort: parsePort(flags['api-port'] || env.NEVO_DASHBOARD_API_PORT || DEFAULT_API_PORT, 'Dashboard API port'),
    // Only consulted when a TLS cert is configured (see server/index.mjs):
    // the dashboard then serves HTTPS on this port and turns `port` (the
    // one already bookmarked from before TLS was set up) into a plain-HTTP
    // redirect to it — the same "legacy HTTP port stays, HTTPS gets a new
    // one" shape ASP.NET Core's Kestrel uses by default. Defaults to
    // `port + 1` so most setups need no extra configuration.
    httpsPort: parsePort(flags['https-port'] || env.NEVO_DASHBOARD_HTTPS_PORT || port + 1, 'Dashboard HTTPS port'),
  };
}

export { DEFAULT_API_PORT, DEFAULT_HOST, DEFAULT_UI_PORT };
