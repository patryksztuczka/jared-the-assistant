import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { messages, outboxEvents, runs, threads, type Schema } from "../../db/schema";
import { EVENT_TYPE, type AgentEvent } from "../events/types";

interface CreateIncomingMessageAndQueueRunInput {
  threadId: string;
  runId: string;
  content: string;
  correlationId: string;
  eventId?: string;
}

interface PersistedIngressRecord {
  messageId: string;
  threadId: string;
  runId: string;
  correlationId: string;
}

export interface ChatIngressStore {
  createIncomingMessageAndQueueRun(
    input: CreateIncomingMessageAndQueueRunInput,
  ): Promise<PersistedIngressRecord>;
}

export const createDrizzleChatIngressStore = (database: LibSQLDatabase<Schema>) => {
  const createIncomingMessageAndQueueRun = async (input: CreateIncomingMessageAndQueueRunInput) => {
    const messageId = crypto.randomUUID();
    const event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED> = {
      id: input.eventId ?? crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_REQUESTED,
      timestamp: new Date().toISOString(),
      correlationId: input.correlationId,
      payload: {
        runId: input.runId,
        threadId: input.threadId,
        prompt: input.content,
      },
    };

    await database.transaction(async (transaction) => {
      await transaction
        .insert(threads)
        .values({
          id: input.threadId,
        })
        .onConflictDoNothing({
          target: threads.id,
        });

      await transaction.insert(messages).values({
        id: messageId,
        threadId: input.threadId,
        role: "user",
        content: input.content,
        correlationId: input.correlationId,
      });

      await transaction.insert(runs).values({
        id: input.runId,
        threadId: input.threadId,
        correlationId: input.correlationId,
        status: "queued",
        safeError: undefined,
      });

      await transaction.insert(outboxEvents).values({
        id: event.id,
        eventType: event.type,
        payload: JSON.stringify(event),
        status: "pending",
        attempts: 0,
        lastError: undefined,
        publishedAt: undefined,
      });
    });

    return {
      messageId,
      threadId: input.threadId,
      runId: input.runId,
      correlationId: input.correlationId,
    } satisfies PersistedIngressRecord;
  };

  return {
    createIncomingMessageAndQueueRun,
  } satisfies ChatIngressStore;
};

export const createInMemoryChatIngressStore = () => {
  const records = new Map<string, PersistedIngressRecord>();

  const createIncomingMessageAndQueueRun = async (input: CreateIncomingMessageAndQueueRunInput) => {
    const messageId = crypto.randomUUID();
    const next = {
      messageId,
      threadId: input.threadId,
      runId: input.runId,
      correlationId: input.correlationId,
    } satisfies PersistedIngressRecord;

    records.set(messageId, next);
    return next;
  };

  return {
    createIncomingMessageAndQueueRun,
  } satisfies ChatIngressStore;
};
