import assert from 'node:assert/strict';
import test from 'node:test';

import { dashboardNetworkConfig, resolveHttpsPort } from '../config/network.mjs';

test('uses loopback and the standard ports by default', () => {
  assert.deepEqual(dashboardNetworkConfig({ argv: [], env: {} }), {
    host: '127.0.0.1',
    port: 4317,
    apiPort: 4318,
    explicitHttpsPort: null,
    httpsPort: null,
  });
});

test('supports host and port overrides through environment variables', () => {
  assert.deepEqual(
    dashboardNetworkConfig({
      argv: [],
      env: {
        NEVO_DASHBOARD_HOST: '100.117.54.81',
        NEVO_DASHBOARD_PORT: '5317',
        NEVO_DASHBOARD_API_PORT: '5318',
      },
    }),
    {
      host: '100.117.54.81',
      port: 5317,
      apiPort: 5318,
      explicitHttpsPort: null,
      httpsPort: null,
    },
  );
});

test('command flags override environment variables', () => {
  assert.deepEqual(
    dashboardNetworkConfig({
      argv: ['--host', '100.117.54.81', '--port=6317', '--api-port', '6318'],
      env: {
        NEVO_DASHBOARD_HOST: '127.0.0.1',
        NEVO_DASHBOARD_PORT: '4317',
        NEVO_DASHBOARD_API_PORT: '4318',
      },
    }),
    {
      host: '100.117.54.81',
      port: 6317,
      apiPort: 6318,
      explicitHttpsPort: null,
      httpsPort: null,
    },
  );
});

test('supports positional values forwarded by nested Windows npm scripts', () => {
  assert.deepEqual(
    dashboardNetworkConfig({
      argv: ['100.117.54.81', '4317', '4318'],
      env: {},
    }),
    {
      host: '100.117.54.81',
      port: 4317,
      apiPort: 4318,
      explicitHttpsPort: null,
      httpsPort: null,
    },
  );
});

test('resolves HTTPS port when requested, defaulting to port + 1 and supporting explicit override', () => {
  assert.equal(resolveHttpsPort({ port: 5317 }), 5318);
  assert.equal(resolveHttpsPort({ port: 5317, explicitHttpsPort: 9443 }), 9443);
  assert.equal(
    resolveHttpsPort(
      dashboardNetworkConfig({
        argv: ['--port', '5317', '--https-port', '9443'],
        env: {},
      }),
    ),
    9443,
  );
  assert.equal(
    resolveHttpsPort(
      dashboardNetworkConfig({
        argv: ['--port', '5317'],
        env: { NEVO_DASHBOARD_HTTPS_PORT: '9443' },
      }),
    ),
    9443,
  );
  assert.equal(dashboardNetworkConfig({ argv: ['--port', '5317', '--https-port', '9443'], env: {} }).httpsPort, 9443);
});

test('--http-port and NEVO_DASHBOARD_HTTP_PORT are aliases for --port / NEVO_DASHBOARD_PORT', () => {
  assert.equal(dashboardNetworkConfig({ argv: ['--http-port', '5317'], env: {} }).port, 5317);
  assert.equal(dashboardNetworkConfig({ argv: [], env: { NEVO_DASHBOARD_HTTP_PORT: '5317' } }).port, 5317);
  assert.equal(dashboardNetworkConfig({ argv: ['--http-port', '5317', '--port', '6317'], env: {} }).port, 5317);
});

test('allows port 65535 in HTTP-only and development configurations', () => {
  const config = dashboardNetworkConfig({ argv: ['--port', '65535'], env: {} });
  assert.equal(config.port, 65535);
  assert.equal(config.explicitHttpsPort, null);
  assert.equal(config.httpsPort, null);

  // Attempting to resolve default HTTPS port when port is 65535 fails because 65536 is out of range
  assert.throws(() => resolveHttpsPort(config), /between 1 and 65535/);
  // An explicit HTTPS port works even when HTTP port is 65535
  assert.equal(resolveHttpsPort({ port: 65535, explicitHttpsPort: 9443 }), 9443);
});

test('rejects conflicting HTTP and HTTPS ports when TLS is active', () => {
  assert.throws(
    () => resolveHttpsPort({ port: 4317, explicitHttpsPort: 4317 }),
    /When TLS is active, HTTP redirect port \(4317\) and HTTPS serving port \(4317\) must be different\./,
  );
  assert.throws(
    () =>
      resolveHttpsPort(
        dashboardNetworkConfig({
          argv: ['--port', '4317', '--https-port', '4317'],
          env: {},
        }),
      ),
    /When TLS is active, HTTP redirect port \(4317\) and HTTPS serving port \(4317\) must be different\./,
  );
});

test('rejects malformed hosts, ports, and options', () => {
  assert.throws(
    () => dashboardNetworkConfig({ argv: ['--host', 'http://100.117.54.81'], env: {} }),
    /without a protocol/,
  );
  assert.throws(() => dashboardNetworkConfig({ argv: ['--port', '70000'], env: {} }), /between 1 and 65535/);
  assert.throws(() => dashboardNetworkConfig({ argv: ['--unknown', 'value'], env: {} }), /Unknown dashboard option/);
});
