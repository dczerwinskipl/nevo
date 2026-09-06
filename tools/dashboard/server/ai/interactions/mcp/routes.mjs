import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNevoMcpServer } from './mcp-server.mjs';
import { mcpInteractionRegistry } from './interaction-registry.mjs';

/**
 * Fastify plugin mounting the server-owned Streamable HTTP MCP transport.
 * Accessible at `/mcp` and `/api/ai/mcp` over loopback.
 */
export default async function mcpRoutes(
  fastify,
  { registry = mcpInteractionRegistry, mcpServer: customMcpServer } = {},
) {
  const mcpServer = customMcpServer || createNevoMcpServer(registry);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  await mcpServer.connect(transport);

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

  // Mount at both standard MCP paths for supported HTTP verbs
  fastify.post('/mcp', handleMcpRequest);
  fastify.get('/mcp', handleMcpRequest);
  fastify.delete('/mcp', handleMcpRequest);

  fastify.post('/api/ai/mcp', handleMcpRequest);
  fastify.get('/api/ai/mcp', handleMcpRequest);
  fastify.delete('/api/ai/mcp', handleMcpRequest);

  fastify.addHook('onClose', async () => {
    try {
      await transport.close();
      registry.shutdown();
    } catch {}
  });
}
