#!/usr/bin/env node
import readline from 'node:readline';
import http from 'node:http';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    port: process.env.NEVO_BRIDGE_PORT || '4318',
    provider: process.env.NEVO_BRIDGE_PROVIDER || 'claude',
    sessionId: process.env.NEVO_BRIDGE_SESSION_ID || '',
    turnId: process.env.NEVO_BRIDGE_TURN_ID || '',
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
    }
  }

  return options;
}

const config = parseArgs();

function sendJsonRpc(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendError(id, code, message) {
  sendJsonRpc({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

function sendResult(id, result) {
  sendJsonRpc({
    jsonrpc: '2.0',
    id,
    result,
  });
}

async function requestDashboardInteraction(toolArgs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      provider: config.provider,
      providerSessionId: config.sessionId,
      turnId: config.turnId,
      question: toolArgs.question || toolArgs.prompt || '',
      header: toolArgs.header || '',
      options: toolArgs.options || [],
      multiSelect: Boolean(toolArgs.multiSelect ?? toolArgs.isMultiSelect),
    });

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: parseInt(config.port, 10) || 4318,
        path: '/api/ai/bridge/ask',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
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
              resolve(data);
            } else {
              reject(new Error(data?.message || `HTTP ${res.statusCode}: ${raw}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse dashboard response: ${err.message}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'nevo-interaction-bridge',
        version: '1.0.0',
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'ping') {
    sendResult(id, {});
    return;
  }

  if (method === 'tools/list') {
    sendResult(id, {
      tools: [
        {
          name: 'ask_user',
          description:
            'Ask the human user a structured question when you need clarification, choices, or approval before proceeding. Blocks until the user answers in the dashboard UI.',
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the user.',
              },
              header: {
                type: 'string',
                description: 'Optional category or header for the question.',
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of choices for the user to select.',
              },
              multiSelect: {
                type: 'boolean',
                description: 'Whether multiple choices can be selected.',
              },
            },
            required: ['question'],
          },
        },
      ],
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    if (
      toolName === 'ask_user' ||
      toolName === 'nevo_ask_question' ||
      toolName === 'ask_question' ||
      toolName === 'AskUserQuestion' ||
      (typeof toolName === 'string' && toolName.endsWith('ask_user'))
    ) {
      try {
        const responseData = await requestDashboardInteraction(toolArgs);
        let formattedAnswer = '';
        if (Array.isArray(responseData?.answers)) {
          formattedAnswer = responseData.answers
            .map((a) => (Array.isArray(a?.value) ? a.value.join(', ') : a?.value !== undefined ? String(a.value) : ''))
            .filter(Boolean)
            .join('\n');
        } else if (typeof responseData?.answer === 'string') {
          formattedAnswer = responseData.answer;
        } else {
          formattedAnswer = JSON.stringify(responseData);
        }

        sendResult(id, {
          content: [
            {
              type: 'text',
              text: `The user provided the following answer:\n${formattedAnswer}`,
            },
          ],
        });
      } catch (err) {
        sendResult(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Interaction failed or was cancelled: ${err.message}`,
            },
          ],
        });
      }
      return;
    }

    sendError(id, -32601, `Tool '${toolName}' not found`);
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method '${method}' not found`);
  }
});
