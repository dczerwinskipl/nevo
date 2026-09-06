import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNevoMcpServer } from './mcp-server.mjs';
import { mcpInteractionRegistry } from './interaction-registry.mjs';

/**
 * Fastify plugin mounting the server-owned Streamable HTTP MCP transport.
 * Accessible at `/mcp` over loopback.
 *
 * Implements official multi-session / multi-client Streamable HTTP lifecycle:
 * - Each client session has its own stateful StreamableHTTPServerTransport keyed by `mcp-session-id`.
 * - Initialization requests (POST containing initialize method) create a new session and transport.
 * - Non-initialization requests with a session ID are dispatched to their session transport.
 * - Missing or invalid session IDs return 400 Bad Request or 404 Session Not Found.
 * - DELETE requests terminate the session and tear down its transport.
 */
export default async function mcpRoutes(
  fastify,
  { registry = mcpInteractionRegistry, mcpServer: customMcpServer, mcpServerFactory } = {},
) {
  const sessions = new Map(); // sessionId -> { transport, server }
  const createServer =
    mcpServerFactory ||
    (typeof customMcpServer === 'function'
      ? customMcpServer
      : customMcpServer
        ? () => customMcpServer
        : () => createNevoMcpServer(registry));

  const handleMcpRequest = async (request, reply) => {
    // Enforce loopback boundary
    const clientIp = request.ip;
    if (
      clientIp &&
      clientIp !== '127.0.0.1' &&
      clientIp !== '::1' &&
      clientIp !== '::ffff:127.0.0.1' &&
      clientIp !== 'localhost'
    ) {
      reply.code(403).send({ message: 'Forbidden: MCP endpoint only accessible from loopback' });
      return;
    }

    const sessionId = request.headers['mcp-session-id'];

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        reply.code(404).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }

      try {
        await session.transport.handleRequest(request.raw, reply.raw, request.body);
        return reply.raw;
      } catch (err) {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader('Content-Type', 'application/json');
          reply.raw.end(JSON.stringify({ error: err.message }));
        }
        return reply.raw;
      }
    }

    // No session ID provided: only POST with initialization is allowed
    const isInit =
      request.method === 'POST' &&
      (request.body?.method === 'initialize' ||
        (Array.isArray(request.body) && request.body.some((m) => m?.method === 'initialize')));

    if (!isInit) {
      reply.code(400).header('content-type', 'application/json').send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required for non-initialization requests' },
        id: null,
      });
      return;
    }

    // Create a new transport and connected MCP server for this session
    let sessionEntry = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        sessionEntry = { transport, server };
        sessions.set(newSessionId, sessionEntry);
      },
      onsessionclosed: async (closedSessionId) => {
        const entry = sessions.get(closedSessionId);
        sessions.delete(closedSessionId);
        if (entry?.server) {
          await entry.server.close().catch(() => {});
        }
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions.has(sid)) {
        const entry = sessions.get(sid);
        sessions.delete(sid);
        if (entry?.server) {
          entry.server.close().catch(() => {});
        }
      }
    };

    const server = createServer();
    await server.connect(transport);

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
      return reply.raw;
    } catch (err) {
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(JSON.stringify({ error: err.message }));
      }
      return reply.raw;
    }
  };

  // Mount at canonical /mcp endpoint for supported HTTP verbs
  fastify.post('/mcp', handleMcpRequest);
  fastify.get('/mcp', handleMcpRequest);
  fastify.delete('/mcp', handleMcpRequest);

  fastify.addHook('onClose', async () => {
    for (const session of sessions.values()) {
      try {
        await session.transport.close();
      } catch {}
      try {
        await session.server.close();
      } catch {}
    }
    sessions.clear();
    registry.shutdown();
  });
}
