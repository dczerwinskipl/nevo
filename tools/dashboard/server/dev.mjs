import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

import { createDashboardServer, listen } from './index.mjs';
import { dashboardNetworkConfig } from './network-config.mjs';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { host, port: uiPort, apiPort } = dashboardNetworkConfig();

const apiServer = createDashboardServer();
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
  await new Promise(resolvePromise => apiServer.close(resolvePromise));
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await vite.close();
  await new Promise(resolvePromise => apiServer.close(resolvePromise));
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
