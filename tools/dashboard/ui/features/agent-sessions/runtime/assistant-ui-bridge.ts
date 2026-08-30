import { useMemo } from 'react';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type { NormalizedMessage } from '../types.ts';

/**
 * Sole point of contact with `@assistant-ui/react`: converts this session's own
 * `NormalizedMessage[]` into `ThreadMessageLike[]` and binds the library's
 * `onNew`/`onCancel` callback contract to this runtime's own send/cancel operations.
 * Isolated from session/SSE state management so the assistant runtime hook composes
 * this as one piece rather than owning the UI adapter binding itself (area
 * ai-assistant-chat-and-runtime-feature-slice, task 07).
 */
export function useAssistantUiBridge({
  messages,
  isRunning,
  onSendText,
  onCancel,
}: {
  messages: NormalizedMessage[];
  isRunning: boolean;
  onSendText: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const assistantMessages: ThreadMessageLike[] = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.text,
      createdAt: new Date(m.createdAt),
    }));
  }, [messages]);

  return useExternalStoreRuntime({
    isRunning,
    messages: assistantMessages,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async (msg) => {
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
      }
      await onSendText(text);
    },
    onCancel,
  });
}
