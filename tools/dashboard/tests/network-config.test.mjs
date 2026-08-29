import assert from 'node:assert/strict';
import test from 'node:test';

import { dashboardNetworkConfig } from '../config/network.mjs';

test('uses loopback and the standard ports by default', () => {
  assert.deepEqual(dashboardNetworkConfig({ argv: [], env: {} }), {
    host: '127.0.0.1',
    port: 4317,
    apiPort: 4318,
  });
});

test('supports host and port overrides through environment variables', () => {
  assert.deepEqual(dashboardNetworkConfig({
    argv: [],
    env: {
      NEVO_DASHBOARD_HOST: '100.117.54.81',
      NEVO_DASHBOARD_PORT: '5317',
      NEVO_DASHBOARD_API_PORT: '5318',
    },
  }), {
    host: '100.117.54.81',
    port: 5317,
    apiPort: 5318,
  });
});

test('command flags override environment variables', () => {
  assert.deepEqual(dashboardNetworkConfig({
    argv: ['--host', '100.117.54.81', '--port=6317', '--api-port', '6318'],
    env: {
      NEVO_DASHBOARD_HOST: '127.0.0.1',
      NEVO_DASHBOARD_PORT: '4317',
      NEVO_DASHBOARD_API_PORT: '4318',
    },
  }), {
    host: '100.117.54.81',
    port: 6317,
    apiPort: 6318,
  });
});

test('supports positional values forwarded by nested Windows npm scripts', () => {
  assert.deepEqual(dashboardNetworkConfig({
    argv: ['100.117.54.81', '4317', '4318'],
    env: {},
  }), {
    host: '100.117.54.81',
    port: 4317,
    apiPort: 4318,
  });
});

test('rejects malformed hosts, ports, and options', () => {
  assert.throws(
    () => dashboardNetworkConfig({ argv: ['--host', 'http://100.117.54.81'], env: {} }),
    /without a protocol/,
  );
  assert.throws(
    () => dashboardNetworkConfig({ argv: ['--port', '70000'], env: {} }),
    /between 1 and 65535/,
  );
  assert.throws(
    () => dashboardNetworkConfig({ argv: ['--unknown', 'value'], env: {} }),
    /Unknown dashboard option/,
  );
});
