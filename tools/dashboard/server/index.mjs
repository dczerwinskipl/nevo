import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildDashboardApp } from './app.mjs';
import { dashboardNetworkConfig } from '../config/network.mjs';

export { buildDashboardApp };

/**
 * Runtime boundary: turns a configured Fastify app (from `buildDashboardApp`)
 * into a listening server. Kept separate from application construction so
 * tests can build and `inject()` against an app without ever binding a port.
 */
export async function listen(app, { port = 4317, host = '127.0.0.1' } = {}) {
  const address = await app.listen({ port, host });
  return address;
}

const isDirectRun = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const { host, port } = dashboardNetworkConfig();
  const app = await buildDashboardApp();
  const url = await listen(app, { port, host });
  console.log(`NEvo dashboard: ${url}`);
  console.log(`NEvo dashboard API: ${url}/api/dashboard`);
  console.warn('AI access mode: trusted network (VPN boundary); requests are not identity-authenticated.');
}
