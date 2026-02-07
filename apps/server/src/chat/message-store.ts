import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { messages, threads, type Schema } from "../../db/schema";

interface CreateIncomingMessageInput {
  threadId: string;
  content: string;
  correlationId: string;
}

interface PersistedMessage {
  messageId: string;
  threadId: string;
}

export interface ChatMessageStore {
  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage>;
}

export const createDrizzleChatMessageStore = (database: LibSQLDatabase<Schema>) => {
  const createIncomingMessage = async (input: CreateIncomingMessageInput) => {
    await database
      .insert(threads)
      .values({
        id: input.threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });

    const messageId = crypto.randomUUID();

    await database.insert(messages).values({
      id: messageId,
      threadId: input.threadId,
      role: "user",
      content: input.content,
      correlationId: input.correlationId,
    });

    return {
      messageId,
      threadId: input.threadId,
    };
  };

  return {
    createIncomingMessage,
  } satisfies ChatMessageStore;
};

export const createInMemoryChatMessageStore = () => {
  const records = new Map<string, PersistedMessage>();

  const createIncomingMessage = async (input: CreateIncomingMessageInput) => {
    const messageId = crypto.randomUUID();
    const record = {
      messageId,
      threadId: input.threadId,
    };

    records.set(messageId, record);
    return record;
  };

  const getById = (messageId: string) => {
    return records.get(messageId);
  };

  return {
    createIncomingMessage,
    getById,
  };
};
