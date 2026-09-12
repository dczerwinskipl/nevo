import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

export function resolveAntigravityMcpBridgePath() {
  return fileURLToPath(new URL('./antigravity-mcp-bridge.mjs', import.meta.url));
}

/**
 * Ensures durable and idempotent registration of the Nevo MCP bridge in Antigravity's
 * global MCP configuration (~/.gemini/config/mcp_config.json via `agy mcp add`).
 *
 * Checks `agy mcp list` and updates only if missing or pointing to an outdated path.
 * Strictly touches only the `nevo` entry; never modifies or removes unrelated user servers.
 */
export function ensureAntigravityMcpRegistered({
  executable = 'agy',
  bridgePath = resolveAntigravityMcpBridgePath(),
  exec = execSync,
} = {}) {
  try {
    let listOutput = '';
    try {
      listOutput = exec(`${executable} mcp list`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      listOutput = '';
    }

    const lines = listOutput.split(/\r?\n/);
    const nevoLine = lines.find((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('nevo ') || trimmed.startsWith('nevo\t');
    });

    const normBridge = bridgePath.replace(/\\/g, '/').toLowerCase();
    if (nevoLine) {
      const normLine = nevoLine.replace(/\\/g, '/').toLowerCase();
      if (normLine.includes(normBridge)) {
        return { registered: true, updated: false };
      }
    }

    exec(`${executable} mcp add nevo node "${bridgePath}"`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { registered: true, updated: true };
  } catch (err) {
    return { registered: false, error: err };
  }
}

/**
 * Runs the stdio MCP bridge forwarding requests to Fastify `/mcp`.
 */
export async function runBridge({
  stdin = process.stdin,
  stdout = process.stdout,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = env.NEVO_INTERACTION_TOKEN;
  const endpoint = env.NEVO_MCP_ENDPOINT || 'http://127.0.0.1:4318/mcp';
  let sessionId = null;

  const rl = createInterface({
    input: stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let envelope;
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!token) {
      // Independent agy run outside Nevo turn: return empty tools and safe responses without errors
      if (envelope.method === 'initialize') {
        stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: envelope.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'nevo', version: '0.1.0' },
            },
          }) + '\n',
        );
      } else if (envelope.method === 'tools/list') {
        stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: envelope.id,
            result: { tools: [] },
          }) + '\n',
        );
      } else if (envelope.id != null) {
        stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: envelope.id,
            error: { code: -32601, message: `Method '${envelope.method}' not found` },
          }) + '\n',
        );
      }
      continue;
    }

    // Active Nevo turn with interaction token: forward to Fastify /mcp
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'x-nevo-interaction-token': token,
    };
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });

      const responseSessionId = res.headers?.get?.('mcp-session-id');
      if (responseSessionId) {
        sessionId = responseSessionId;
      }

      const contentType = res.headers?.get?.('content-type') || '';
      if (res.status === 200) {
        if (contentType.includes('application/json')) {
          const data = await res.json();
          stdout.write(JSON.stringify(data) + '\n');
        } else {
          const text = await res.text();
          const lines = text.split('\n');
          let parsedAny = false;
          for (const l of lines) {
            const trimmedLine = l.trim();
            if (trimmedLine.startsWith('data:')) {
              const jsonStr = trimmedLine.slice(5).trim();
              if (jsonStr) {
                try {
                  const data = JSON.parse(jsonStr);
                  stdout.write(JSON.stringify(data) + '\n');
                  parsedAny = true;
                } catch {}
              }
            }
          }
          if (!parsedAny && text.trim()) {
            try {
              const data = JSON.parse(text.trim());
              stdout.write(JSON.stringify(data) + '\n');
            } catch {}
          }
        }
      } else {
        let errJson = null;
        try {
          errJson = await res.json();
        } catch {}
        if (errJson && errJson.jsonrpc) {
          if (envelope.id != null && errJson.id == null) {
            errJson.id = envelope.id;
          }
          stdout.write(JSON.stringify(errJson) + '\n');
        } else if (envelope.id != null) {
          stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: envelope.id,
              error: {
                code: res.status === 403 ? -32003 : -32603,
                message: errJson?.error?.message || errJson?.message || `HTTP ${res.status}: ${res.statusText}`,
              },
            }) + '\n',
          );
        }
      }
    } catch (fetchErr) {
      if (envelope.id != null) {
        stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: envelope.id,
            error: {
              code: -32603,
              message: `MCP bridge forwarding error: ${fetchErr.message}`,
            },
          }) + '\n',
        );
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runBridge().catch((err) => {
    console.error('[antigravity-mcp-bridge] Fatal error:', err);
    process.exit(1);
  });
}
