import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

import { buildDashboardApp, listen } from './index.mjs';
import { dashboardNetworkConfig } from './network-config.mjs';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { host, port: uiPort, apiPort } = dashboardNetworkConfig();

const apiServer = await buildDashboardApp();
const apiUrl = await listen(apiServer, { host, port: apiPort });
process.env.NEVO_DASHBOARD_API_URL = apiUrl;

let vite;
try {
  vite = await createViteServer({
    root: dashboardRoot,
    configFile: resolve(dashboardRoot, 'vite.config.ts'),
    server: { host, port: uiPort, strictPort: true },
  });
  await vite.listen();
  console.log(`NEvo dashboard API: ${apiUrl}`);
  vite.printUrls();
} catch (error) {
  await apiServer.close();
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await vite.close();
  await apiServer.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
