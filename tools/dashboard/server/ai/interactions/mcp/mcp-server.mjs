import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpInteractionRegistry } from './interaction-registry.mjs';

/**
 * Formats a canonical user interaction response into human-readable text for the model.
 */
export function formatInteractionAnswer(responseData) {
  if (Array.isArray(responseData?.answers)) {
    return responseData.answers
      .map((a) => (Array.isArray(a?.value) ? a.value.join(', ') : a?.value !== undefined ? String(a.value) : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof responseData?.answer === 'string') {
    return responseData.answer;
  }
  if (responseData?.answer !== undefined) {
    return String(responseData.answer);
  }
  return JSON.stringify(responseData);
}

/**
 * Creates the single server-owned Nevo MCP server instance.
 * Exposes exactly one canonical tool: `ask_user`.
 */
export function createNevoMcpServer(
  interactionRegistry = mcpInteractionRegistry,
  { boundTurnId, boundToken } = {},
) {
  const server = new McpServer({
    name: 'nevo',
    version: '1.0.0',
  });

  const toolDescription =
    'Ask the human user a structured question when you need clarification, choices, or approval before proceeding. Blocks until the user answers in the dashboard UI.';

  const toolSchema = {
    question: z.string().describe('The question to ask the user.'),
    header: z.string().optional().describe('Optional category or header for the question.'),
    options: z
      .array(z.union([z.string(), z.object({ label: z.string(), description: z.string().optional() })]))
      .optional()
      .describe('Optional list of choices for the user to select.'),
    multiSelect: z.boolean().optional().describe('Whether multiple choices can be selected.'),
  };

  server.tool('ask_user', toolDescription, toolSchema, async (args, extra) => {
    const questionText = String(args.question || '').trim();
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

    const reqToken =
      extra?.requestInfo?.headers?.['x-nevo-interaction-token'] ||
      extra?.requestInfo?.headers?.['X-Nevo-Interaction-Token'];

    let activeTurn;
    if (boundTurnId) {
      // Invariant: Every request associated with a Nevo-bound session must carry x-nevo-interaction-token
      if (!reqToken) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Forbidden: missing x-nevo-interaction-token header.',
            },
          ],
        };
      }

      // Invariant: An established session cannot switch Turn ownership via a mismatched token header
      if (boundToken && reqToken !== boundToken) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Forbidden: interaction token does not match the bound session turn.',
            },
          ],
        };
      }

      activeTurn = interactionRegistry.getActiveTurn({ turnId: boundTurnId });
      if (!activeTurn || typeof activeTurn.requestInteraction !== 'function') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Error: invalid, stale, or expired turn correlation token.',
            },
          ],
        };
      }
    } else {
      // Fallback for unbound servers (e.g. direct in-memory unit tests)
      if (!reqToken) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Forbidden: missing x-nevo-interaction-token header.',
            },
          ],
        };
      }

      activeTurn = interactionRegistry.getActiveTurnByToken(reqToken);
      if (!activeTurn || typeof activeTurn.requestInteraction !== 'function') {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Error: invalid, stale, or expired turn correlation token.',
            },
          ],
        };
      }
    }

    const formattedOptions =
      Array.isArray(args.options) && args.options.length > 0
        ? args.options.map((opt) => {
            if (typeof opt === 'string') return { label: opt, description: opt };
            return {
              label: String(opt.label || opt.text || opt.title || ''),
              description: String(opt.description || opt.desc || opt.label || opt.text || ''),
            };
          })
        : undefined;

    const neutral = {
      kind: 'question',
      questions: [
        {
          question: questionText,
          ...(args.header ? { header: String(args.header) } : {}),
          ...(formattedOptions ? { options: formattedOptions } : {}),
          multiSelect: Boolean(args.multiSelect),
        },
      ],
    };

    try {
      const interaction = await activeTurn.requestInteraction(neutral, { resumePolicy: 'live-operation' });
      interactionRegistry.registerPending(interaction.id, {
        turnId: activeTurn.turnId,
        provider: activeTurn.provider,
        providerSessionId: activeTurn.providerSessionId,
      });

      const responseData = await interactionRegistry.waitForResponse(interaction.id);
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
  });

  return server;
}
