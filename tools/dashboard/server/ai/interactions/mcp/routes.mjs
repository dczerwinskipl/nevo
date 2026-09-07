import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNevoMcpServer } from './mcp-server.mjs';
import { mcpInteractionRegistry } from './interaction-registry.mjs';
import { mcpSessionManager } from './session-manager.mjs';

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
 *
 * Invariant:
 * Every MCP session is bound to exactly one Nevo Turn.
 * Every request associated with a session must carry `x-nevo-interaction-token` matching
 * the bound session token. When the Nevo Turn becomes terminal, all MCP sessions bound
 * to that Turn are closed and their resources released.
 */
export default async function mcpRoutes(
  fastify,
  {
    registry = mcpInteractionRegistry,
    sessionManager = registry.sessionManager || mcpSessionManager,
    mcpServer: customMcpServer,
    mcpServerFactory,
  } = {},
) {
  const createServer = (options) => {
    if (mcpServerFactory) return mcpServerFactory(options);
    if (typeof customMcpServer === 'function') return customMcpServer(options);
    if (customMcpServer) return customMcpServer;
    return createNevoMcpServer(registry, options);
  };

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
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        reply.code(404).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }

      // Invariant: Every request associated with a Nevo-bound session must carry x-nevo-interaction-token
      const reqToken =
        request.headers['x-nevo-interaction-token'] || request.headers['X-Nevo-Interaction-Token'];
      if (!reqToken) {
        reply.code(403).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: {
            code: -32003,
            message: 'Forbidden: missing x-nevo-interaction-token header.',
          },
          id: null,
        });
        return;
      }

      // Invariant: Token must strictly match the token bound to this MCP session
      if (reqToken !== session.token) {
        reply.code(403).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: {
            code: -32003,
            message: 'Forbidden: interaction token does not match the bound session turn. Session ownership cannot be reassigned.',
          },
          id: null,
        });
        return;
      }

      // Invariant: Bound turn must still be active and non-stale
      const activeTurn = registry.getActiveTurn({ turnId: session.turnId });
      if (!activeTurn || activeTurn.token !== session.token) {
        reply.code(403).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: {
            code: -32003,
            message: 'Forbidden: invalid, stale, or expired turn correlation token.',
          },
          id: null,
        });
        return;
      }

      // Duplicate/replayed initialize on an already-established session is deterministically rejected
      const isInit =
        request.method === 'POST' &&
        (request.body?.method === 'initialize' ||
          (Array.isArray(request.body) && request.body.some((m) => m?.method === 'initialize')));

      if (isInit) {
        reply.code(400).header('content-type', 'application/json').send({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: session is already initialized. Ownership cannot be reassigned.',
          },
          id: null,
        });
        return;
      }

      // DELETE requests terminate the session immediately
      if (request.method === 'DELETE') {
        await sessionManager.closeSession(sessionId);
        reply.code(200).send({ ok: true });
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

    const initToken =
      request.headers['x-nevo-interaction-token'] || request.headers['X-Nevo-Interaction-Token'];

    if (!initToken) {
      reply.code(403).header('content-type', 'application/json').send({
        jsonrpc: '2.0',
        error: {
          code: -32003,
          message: 'Forbidden: missing x-nevo-interaction-token header during initialization.',
        },
        id: null,
      });
      return;
    }

    const boundTurn = registry.getActiveTurnByToken(initToken);
    if (!boundTurn) {
      reply.code(403).header('content-type', 'application/json').send({
        jsonrpc: '2.0',
        error: {
          code: -32003,
          message: 'Forbidden: invalid, stale, or expired turn correlation token.',
        },
        id: null,
      });
      return;
    }

    // Create a new transport and connected MCP server for this session bound to this Turn
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (newSessionId) => {
        sessionManager.registerSession(newSessionId, {
          transport,
          server,
          turnId: boundTurn.turnId,
          token: initToken,
        });
      },
      onsessionclosed: async (closedSessionId) => {
        await sessionManager.closeSession(closedSessionId);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessionManager.hasSession(sid)) {
        sessionManager.closeSession(sid).catch(() => {});
      }
    };

    const server = createServer({ boundTurnId: boundTurn.turnId, boundToken: initToken });
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
    await sessionManager.closeAll();
    registry.shutdown();
  });
}
