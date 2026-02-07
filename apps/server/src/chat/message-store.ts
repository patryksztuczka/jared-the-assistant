import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
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

export interface ChatHistoryMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  correlationId: string;
  createdAt: string;
}

export interface ChatMessageStore {
  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage>;
  listMessagesByThreadId(threadId: string): Promise<ChatHistoryMessage[]>;
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

  const listMessagesByThreadId = async (threadId: string) => {
    const results = await database
      .select({
        id: messages.id,
        threadId: messages.threadId,
        role: messages.role,
        content: messages.content,
        correlationId: messages.correlationId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt));

    return results.map((result) => {
      return {
        id: result.id,
        threadId: result.threadId,
        role: result.role,
        content: result.content,
        correlationId: result.correlationId,
        createdAt: result.createdAt.toISOString(),
      };
    });
  };

  return {
    createIncomingMessage,
    listMessagesByThreadId,
  } satisfies ChatMessageStore;
};

export const createInMemoryChatMessageStore = () => {
  const records = new Map<string, ChatHistoryMessage>();

  const createIncomingMessage = async (input: CreateIncomingMessageInput) => {
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: ChatHistoryMessage = {
      id: messageId,
      threadId: input.threadId,
      role: "user",
      content: input.content,
      correlationId: input.correlationId,
      createdAt: now,
    };

    records.set(messageId, record);
    return {
      messageId,
      threadId: input.threadId,
    };
  };

  const listMessagesByThreadId = async (threadId: string) => {
    return [...records.values()].filter((record) => {
      return record.threadId === threadId;
    });
  };

  const getById = (messageId: string) => {
    return records.get(messageId);
  };

  return {
    createIncomingMessage,
    listMessagesByThreadId,
    getById,
  };
};
