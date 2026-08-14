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
  const supported = new Set(['host', 'port', 'api-port']);

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

  return {
    host,
    port: parsePort(flags.port || env.NEVO_DASHBOARD_PORT || env.PORT || DEFAULT_UI_PORT, 'Dashboard port'),
    apiPort: parsePort(flags['api-port'] || env.NEVO_DASHBOARD_API_PORT || DEFAULT_API_PORT, 'Dashboard API port'),
  };
}

export { DEFAULT_API_PORT, DEFAULT_HOST, DEFAULT_UI_PORT };
