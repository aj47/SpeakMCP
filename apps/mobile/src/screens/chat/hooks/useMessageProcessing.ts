import { useCallback } from 'react';
import { ChatMessage, AgentProgressUpdate } from '../../../lib/openaiClient';
import { useSessionContext } from '../../../store/sessions';
import { useMessageQueueContext } from '../../../store/message-queue';
import { useConfigContext } from '../../../store/config';
import { useConnectionManager } from '../../../store/connectionManager';
import { preprocessTextForTTS } from '@speakmcp/shared';
import * as Speech from 'expo-speech';

export interface MessageProcessingResult {
  send: (text: string) => Promise<void>;
  processQueuedMessage: (queuedMsg: { id: string; text: string }) => Promise<void>;
  convertProgressToMessages: (update: AgentProgressUpdate) => ChatMessage[];
}

interface UseMessageProcessingProps {
  messages: ChatMessage[];
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  responding: boolean;
  setResponding: (value: boolean) => void;
  setDebugInfo: (value: string) => void;
  setLastFailedMessage: (value: string | null) => void;
  currentSessionIdRef: React.MutableRefObject<string | null>;
  activeRequestIdRef: React.MutableRefObject<number>;
  setConnectionState: (value: any) => void;
  getSessionClient: () => any;
  currentConversationId: string;
  messageQueueEnabled: boolean;
}

export function useMessageProcessing(props: UseMessageProcessingProps): MessageProcessingResult {
  const { config } = useConfigContext();
  const sessionStore = useSessionContext();
  const messageQueue = useMessageQueueContext();
  const connectionManager = useConnectionManager();

  const convertProgressToMessages = useCallback((update: AgentProgressUpdate): ChatMessage[] => {
    const messages: ChatMessage[] = [];

    if (update.steps && update.steps.length > 0) {
      let currentToolCalls: any[] = [];
      let currentToolResults: any[] = [];
      let thinkingContent = '';

      for (const step of update.steps) {
        const stepContent = step.content || step.llmContent;
        if (step.type === 'thinking' && stepContent) {
          thinkingContent = stepContent;
        } else if (step.type === 'tool_call') {
          if (step.toolCall) {
            currentToolCalls.push(step.toolCall);
          }
          if (step.toolResult) {
            currentToolResults.push(step.toolResult);
          }
        } else if (step.type === 'tool_result' && step.toolResult) {
          currentToolResults.push(step.toolResult);
        } else if (step.type === 'completion' && stepContent) {
          thinkingContent = stepContent;
        }
      }

      if (currentToolCalls.length > 0 || currentToolResults.length > 0 || thinkingContent) {
        messages.push({
          role: 'assistant',
          content: thinkingContent || (currentToolCalls.length > 0 ? 'Executing tools...' : ''),
          toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
          toolResults: currentToolResults.length > 0 ? currentToolResults : undefined,
        });
      }
    }

    if (update.conversationHistory && update.conversationHistory.length > 0) {
      let currentTurnStartIndex = 0;
      for (let i = 0; i < update.conversationHistory.length; i++) {
        if (update.conversationHistory[i].role === 'user') {
          currentTurnStartIndex = i;
        }
      }

      const hasAssistantMessages = currentTurnStartIndex + 1 < update.conversationHistory.length;
      if (hasAssistantMessages) {
        messages.length = 0;

        for (let i = currentTurnStartIndex + 1; i < update.conversationHistory.length; i++) {
          const historyMsg = update.conversationHistory[i];

          if (historyMsg.role === 'tool' && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'assistant' && lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
              const hasToolResults = historyMsg.toolResults && historyMsg.toolResults.length > 0;
              const hasContent = historyMsg.content && historyMsg.content.trim().length > 0;

              if (hasToolResults) {
                lastMessage.toolResults = [
                  ...(lastMessage.toolResults || []),
                  ...(historyMsg.toolResults || []),
                ];
                if (hasContent) {
                  lastMessage.content = (lastMessage.content || '') +
                    (lastMessage.content ? '\n' : '') + historyMsg.content;
                }
                continue;
              }
            }
          }

          messages.push({
            role: historyMsg.role === 'tool' ? 'assistant' : historyMsg.role,
            content: historyMsg.content || '',
            toolCalls: historyMsg.toolCalls,
            toolResults: historyMsg.toolResults,
          });
        }
      }
    }

    if (update.streamingContent?.text) {
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        messages[messages.length - 1].content = update.streamingContent.text;
      } else {
        messages.push({
          role: 'assistant',
          content: update.streamingContent.text,
        });
      }
    }

    return messages;
  }, []);

  // Note: Full implementation of send and processQueuedMessage would go here
  // For brevity and to avoid circular dependency issues, placeholders are provided
  const send = useCallback(async (text: string) => {
    // Implementation moved to component for now due to complexity
  }, []);

  const processQueuedMessage = useCallback(async (queuedMsg: { id: string; text: string }) => {
    // Implementation moved to component for now due to complexity
  }, []);

  return {
    send,
    processQueuedMessage,
    convertProgressToMessages,
  };
}
