#!/usr/bin/env node
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function parseArgs(args = process.argv.slice(2)) {
  const options = {
    port: process.env.NEVO_BRIDGE_PORT || '4318',
    provider: process.env.NEVO_BRIDGE_PROVIDER || 'claude',
    sessionId: process.env.NEVO_BRIDGE_SESSION_ID || '',
    turnId: process.env.NEVO_BRIDGE_TURN_ID || '',
    token: process.env.NEVO_BRIDGE_TOKEN || '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && i + 1 < args.length) {
      options.port = args[++i];
    } else if (arg === '--provider' && i + 1 < args.length) {
      options.provider = args[++i];
    } else if (arg === '--session' && i + 1 < args.length) {
      options.sessionId = args[++i];
    } else if (arg === '--turn' && i + 1 < args.length) {
      options.turnId = args[++i];
    } else if (arg === '--token' && i + 1 < args.length) {
      options.token = args[++i];
    }
  }

  return options;
}

export async function requestDashboardInteraction(config, toolArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const questionText = String(toolArgs.question || toolArgs.prompt || '').trim();
    const payload = JSON.stringify({
      provider: config.provider,
      providerSessionId: config.sessionId,
      turnId: config.turnId,
      bridgeToken: config.token,
      question: questionText,
      header: toolArgs.header || '',
      options: toolArgs.options || [],
      multiSelect: Boolean(toolArgs.multiSelect ?? toolArgs.isMultiSelect),
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (config.token) {
      headers['x-bridge-token'] = config.token;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: parseInt(config.port, 10) || 4318,
        path: '/api/ai/bridge/ask',
        method: 'POST',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolvePromise(data);
            } else {
              rejectPromise(new Error(data?.message || `HTTP ${res.statusCode}: ${raw}`));
            }
          } catch (err) {
            rejectPromise(new Error(`Failed to parse dashboard response: ${err.message}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      rejectPromise(err);
    });

    req.write(payload);
    req.end();
  });
}

export function formatInteractionAnswer(responseData) {
  let formattedAnswer = '';
  if (Array.isArray(responseData?.answers)) {
    formattedAnswer = responseData.answers
      .map((a) => (Array.isArray(a?.value) ? a.value.join(', ') : a?.value !== undefined ? String(a.value) : ''))
      .filter(Boolean)
      .join('\n');
  } else if (typeof responseData?.answer === 'string') {
    formattedAnswer = responseData.answer;
  } else if (responseData?.answer !== undefined) {
    formattedAnswer = String(responseData.answer);
  } else {
    formattedAnswer = JSON.stringify(responseData);
  }
  return formattedAnswer;
}

export function createBridgeMcpServer(config = {}, { requestInteraction = requestDashboardInteraction } = {}) {
  const server = new McpServer({
    name: 'nevo-interaction-bridge',
    version: '1.0.0',
  });

  const toolDescription =
    'Ask the human user a structured question when you need clarification, choices, or approval before proceeding. Blocks until the user answers in the dashboard UI.';

  const toolSchema = {
    question: z.string().optional().describe('The question to ask the user.'),
    prompt: z.string().optional().describe('Alternative name for question.'),
    header: z.string().optional().describe('Optional category or header for the question.'),
    options: z
      .array(z.union([z.string(), z.object({ label: z.string(), description: z.string().optional() })]))
      .optional()
      .describe('Optional list of choices for the user to select.'),
    multiSelect: z.boolean().optional().describe('Whether multiple choices can be selected.'),
    isMultiSelect: z.boolean().optional().describe('Alternative name for multiSelect.'),
  };

  const createHandler = () => async (args) => {
    const questionText = String(args.question || args.prompt || '').trim();
    if (!questionText) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Validation error: question is required.',
          },
        ],
      };
    }

    try {
      const responseData = await requestInteraction(config, args);
      const formattedAnswer = formatInteractionAnswer(responseData);
      return {
        content: [
          {
            type: 'text',
            text: `The user provided the following answer:\n${formattedAnswer}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Interaction failed or was cancelled: ${err.message}`,
          },
        ],
      };
    }
  };

  // Primary tool name expected by Claude Code MCP configuration
  server.tool('ask_user', toolDescription, toolSchema, createHandler());

  // Aliases for compatibility across tool naming patterns
  server.tool('mcp__nevo__ask_user', toolDescription, toolSchema, createHandler());
  server.tool('ask_question', toolDescription, toolSchema, createHandler());
  server.tool('nevo_ask_question', toolDescription, toolSchema, createHandler());
  server.tool('AskUserQuestion', toolDescription, toolSchema, createHandler());

  return server;
}

export async function runBridgeServer(options = {}, transport = null) {
  const config = { ...parseArgs(), ...options };
  const server = createBridgeMcpServer(config);
  const serverTransport = transport || new StdioServerTransport();
  await server.connect(serverTransport);
  return { server, transport: serverTransport };
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)));

if (isMainModule) {
  runBridgeServer().catch((err) => {
    console.error('[nevo-mcp-bridge] Fatal error starting bridge server:', err);
    process.exit(1);
  });
}
