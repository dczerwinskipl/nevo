#!/usr/bin/env node
import { createClaudeContinuationStore } from './continuation-store.mjs';
import { AiValidationError } from '../../contracts.mjs';

export function buildAskUserQuestionUpdatedInput(record) {
  const userAnswers = record.response?.answers || record.response?.value || [];
  const answersByQuestionId = new Map(userAnswers.map((x) => [x.questionId, x.value]));

  const originalQuestions = record.toolInput?.questions || [];
  const answers = {};

  for (let i = 0; i < originalQuestions.length; i++) {
    const originalQuestion = originalQuestions[i];
    const nevoQuestionId = `q-${i + 1}`;

    let answer = answersByQuestionId.get(nevoQuestionId);
    if (answer === undefined) {
      answer = answersByQuestionId.get(originalQuestion.question);
    }
    if (answer === undefined) {
      throw new AiValidationError(`Missing answer for ${nevoQuestionId}`);
    }

    answers[originalQuestion.question] = answer;
  }

  return {
    questions: originalQuestions,
    answers,
  };
}

export async function handlePreToolUse(input, { store = createClaudeContinuationStore() } = {}) {
  const { session_id: sessionId, tool_name: toolName, tool_use_id: toolUseId, tool_input: toolInput } = input || {};

  if (!sessionId) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    };
  }

  const record = store.findMatchingContinuation({
    providerSessionId: sessionId,
    toolUseId,
    toolName,
    toolInput,
  });

  if (record && (record.state === 'resolved' || record.state === 'delivered')) {
    store.markDelivered({
      providerSessionId: record.providerSessionId,
      interactionId: record.interactionId,
    });

    if (toolName === 'AskUserQuestion' || record.toolName === 'AskUserQuestion') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: buildAskUserQuestionUpdatedInput(record),
        },
      };
    }

    // Permission decisions
    const isAllow =
      record.response?.decision === 'allow' || record.response?.confirmed === true || record.response?.type === 'allow';
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
          permissionDecisionReason: record.response?.message || record.response?.reason || 'User denied permission',
        },
      };
    }
  }

  // If AskUserQuestion and no resolved decision, defer
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

async function readStdinJson() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

async function main() {
  const input = await readStdinJson();
  if (input.hook_event_name !== 'PreToolUse') {
    process.exit(0);
  }
  const result = await handlePreToolUse(input);
  if (result) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('hook.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  });
}
