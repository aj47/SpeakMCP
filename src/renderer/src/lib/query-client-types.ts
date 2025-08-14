// Type definitions for React Query hooks
// This file provides proper type annotations for our query client

import { Config, Conversation, ConversationHistoryItem } from "@shared/types"

// Type definitions for query results
export type ConfigQueryResult = Config
export type ConversationHistoryQueryResult = ConversationHistoryItem[]
export type ConversationQueryResult = Conversation | null
export type SaveConversationMutationVariables = Conversation
export type SaveConversationMutationResult = void

// Ensure these types match the TIPC client return types
export interface QueryClientTypes {
  config: Config
  "conversation-history": ConversationHistoryItem[]
  conversation: Conversation
}
