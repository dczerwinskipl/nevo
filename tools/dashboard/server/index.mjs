import { resolve, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { buildDashboardApp } from './app.mjs';
import { dashboardNetworkConfig } from '../config/network.mjs';

export { buildDashboardApp };

const DASHBOARD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TLS_CERT_PATH = resolve(DASHBOARD_ROOT, 'config', 'tls-cert.pem');
const TLS_KEY_PATH = resolve(DASHBOARD_ROOT, 'config', 'tls-key.pem');

/**
 * Runtime boundary: turns a configured Fastify app (from `buildDashboardApp`)
 * into a listening server. Kept separate from application construction so
 * tests can build and `inject()` against an app without ever binding a port.
 */
export async function listen(app, { port = 4317, host = '127.0.0.1' } = {}) {
  const address = await app.listen({ port, host });
  return address;
}

/**
 * Loads TLS cert+key from `config/tls-cert.pem` and `config/tls-key.pem`
 * when both files are present. Returns null when either is missing so the
 * server falls back to plain HTTP — no breakage for environments without certs.
 * Generate the files once with:
 *   mkcert -key-file config/tls-key.pem -cert-file config/tls-cert.pem <host> localhost 127.0.0.1
 */
function loadTlsConfig() {
  if (!existsSync(TLS_CERT_PATH) || !existsSync(TLS_KEY_PATH)) return null;
  try {
    return {
      cert: readFileSync(TLS_CERT_PATH),
      key: readFileSync(TLS_KEY_PATH),
    };
  } catch (err) {
    console.warn(`[server] TLS cert found but could not be read — falling back to HTTP: ${err.message}`);
    return null;
  }
}

/**
 * Starts a plain-HTTP server whose only job is to redirect every request to
 * the HTTPS equivalent. Bound to `redirectPort` — the dashboard's ordinary
 * `port` (the one already bookmarked from before TLS was set up), so an old
 * `http://host:<port>/` link keeps working instead of hitting ERR_EMPTY_RESPONSE.
 * Fails gracefully — if the port is unavailable it logs a warning and the
 * main HTTPS server keeps running unaffected.
 *
 * Deliberately a *separate* port from HTTPS rather than sharing one: a raw
 * TCP-level multiplexer (peek the first byte, route 0x16/TLS ClientHello vs.
 * plain HTTP to two different servers on one port) was tried and discarded —
 * handing an already-touched socket to Node's `https`/`http2` server via a
 * manual `emit('connection', socket)` corrupts the TLS handshake, because
 * those servers take over the socket's handle at a lower level than
 * `http.Server` does and don't see data replayed via `unshift()`. Two ports
 * (the same "legacy HTTP port, new HTTPS port" shape Kestrel uses by default
 * in ASP.NET Core) is the robust option.
 */
function startHttpRedirectServer({ httpsUrl, host, redirectPort }) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const target = new URL(req.url ?? '/', httpsUrl).href;
      res.writeHead(301, { Location: target, 'Content-Length': '0' });
      res.end();
    });
    server.listen(redirectPort, host, () => {
      console.log(`NEvo dashboard HTTP redirect: http://${host}:${redirectPort} → ${httpsUrl}`);
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EACCES') {
        console.warn(
          `[server] HTTP redirect: port ${redirectPort} requires elevated privileges — skipped. Access the dashboard directly at ${httpsUrl}`,
        );
      } else if (err.code === 'EADDRINUSE') {
        console.warn(`[server] HTTP redirect: port ${redirectPort} already in use — skipped.`);
      } else {
        console.warn(`[server] HTTP redirect could not start: ${err.message}`);
      }
      resolve(null);
    });
  });
}

const isDirectRun = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const { host, port, httpsPort } = dashboardNetworkConfig();
  const tls = loadTlsConfig();
  const app = await buildDashboardApp({ config: { tls } });

  if (tls) {
    const httpsUrl = await listen(app, { port: httpsPort, host });
    console.log(`NEvo dashboard: ${httpsUrl}`);
    console.log(`NEvo dashboard API: ${httpsUrl}/api/dashboard`);
    console.log(`TLS: HTTP/2 enabled (cert: ${TLS_CERT_PATH})`);
    await startHttpRedirectServer({ httpsUrl, host, redirectPort: port });
  } else {
    const url = await listen(app, { port, host });
    console.log(`NEvo dashboard: ${url}`);
    console.log(`NEvo dashboard API: ${url}/api/dashboard`);
  }
  console.warn('AI access mode: trusted network (VPN boundary); requests are not identity-authenticated.');
}
