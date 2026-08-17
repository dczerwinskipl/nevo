#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createClaudeContinuationStore } from './claude-continuation-store.mjs';

export function executeClaudeHook(inputJson, { store = createClaudeContinuationStore() } = {}) {
  let payload;
  try {
    payload = typeof inputJson === 'string' ? JSON.parse(inputJson) : inputJson;
  } catch {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    };
  }

  const { session_id: sessionId, tool_name: toolName, tool_use_id: toolUseId, tool_input: toolInput } = payload || {};

  if (!sessionId) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    };
  }

  const resolved = store.findMatchingContinuation({
    providerSessionId: sessionId,
    toolUseId,
    toolName,
  });

  if (resolved && resolved.state === 'resolved') {
    store.consumeContinuation({
      providerSessionId: resolved.providerSessionId,
      interactionId: resolved.interactionId,
    });

    if (toolName === 'AskUserQuestion' || resolved.toolName === 'AskUserQuestion') {
      const answers = {};
      const originalQuestions = resolved.originalToolInput?.questions || [];
      const userAnswers = resolved.userResponse?.answers || [];

      for (const ans of userAnswers) {
        let matchQuestion = null;
        if (ans.questionId && ans.questionId.startsWith('q-')) {
          const idx = parseInt(ans.questionId.replace('q-', ''), 10) - 1;
          matchQuestion = originalQuestions[idx];
        }
        if (!matchQuestion) {
          matchQuestion = originalQuestions.find(q => q.question === ans.questionId || q.id === ans.questionId);
        }
        const questionKey = matchQuestion?.question || ans.questionId;
        answers[questionKey] = ans.value;
      }

      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: {
            ...(resolved.originalToolInput || {}),
            answers,
          },
        },
      };
    }

    // Permission decisions
    const isAllow = resolved.userResponse?.decision === 'allow' || resolved.userResponse?.confirmed === true;
    if (isAllow) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      };
    } else {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: resolved.userResponse?.message || 'User denied permission',
        },
      };
    }
  }

  // No resolved response yet: defer AskUserQuestion
  if (toolName === 'AskUserQuestion') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
}

// If invoked as CLI script
if (process.argv[1] && (process.argv[1].endsWith('claude-hook.mjs') || process.argv[1].includes('claude-hook'))) {
  try {
    const rawInput = readFileSync(0, 'utf-8');
    const result = executeClaudeHook(rawInput);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Hook error: ${err.message}\n`);
    process.exit(0); // Exit 0 with default allow to not break Claude
  }
}
