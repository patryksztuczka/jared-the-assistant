import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { runs, threads, type Schema } from "../../../db/schema";

export type RunStatus = "queued" | "processing" | "completed" | "failed";

export interface ChatRun {
  id: string;
  threadId: string;
  correlationId: string;
  status: RunStatus;
  safeError?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateQueuedRunInput {
  id: string;
  threadId: string;
  correlationId: string;
}

interface UpdateRunStatusInput {
  runId: string;
  status: RunStatus;
  safeError?: string;
}

export interface ChatRunService {
  createQueuedRun(input: CreateQueuedRunInput): Promise<ChatRun>;
  updateRunStatus(input: UpdateRunStatusInput): Promise<ChatRun | undefined>;
  getRunById(runId: string): Promise<ChatRun | undefined>;
}

export const createDrizzleChatRunService = (database: LibSQLDatabase<Schema>) => {
  const createQueuedRun = async (input: CreateQueuedRunInput) => {
    await database
      .insert(threads)
      .values({
        id: input.threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });

    await database.insert(runs).values({
      id: input.id,
      threadId: input.threadId,
      correlationId: input.correlationId,
      status: "queued",
      safeError: undefined,
    });

    const run = await getRunById(input.id);
    if (!run) {
      throw new Error("Failed to create queued run");
    }

    return run;
  };

  const updateRunStatus = async (input: UpdateRunStatusInput) => {
    const safeError = input.status === "failed" ? input.safeError : undefined;

    await database
      .update(runs)
      .set({
        status: input.status,
        safeError,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId));

    return getRunById(input.runId);
  };

  const getRunById = async (runId: string) => {
    const result = await database
      .select({
        id: runs.id,
        threadId: runs.threadId,
        correlationId: runs.correlationId,
        status: runs.status,
        safeError: runs.safeError,
        createdAt: runs.createdAt,
        updatedAt: runs.updatedAt,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);

    const first = result[0];
    if (!first) {
      return;
    }

    return {
      id: first.id,
      threadId: first.threadId,
      correlationId: first.correlationId,
      status: first.status,
      safeError: first.safeError ?? undefined,
      createdAt: first.createdAt.toISOString(),
      updatedAt: first.updatedAt.toISOString(),
    } satisfies ChatRun;
  };

  return {
    createQueuedRun,
    updateRunStatus,
    getRunById,
  } satisfies ChatRunService;
};

export const createInMemoryChatRunService = () => {
  const records = new Map<string, ChatRun>();

  const createQueuedRun = async (input: CreateQueuedRunInput) => {
    const now = new Date().toISOString();
    const run: ChatRun = {
      id: input.id,
      threadId: input.threadId,
      correlationId: input.correlationId,
      status: "queued",
      safeError: undefined,
      createdAt: now,
      updatedAt: now,
    };

    records.set(run.id, run);
    return run;
  };

  const updateRunStatus = async (input: UpdateRunStatusInput) => {
    const existing = records.get(input.runId);
    if (!existing) {
      return;
    }

    const next: ChatRun = {
      ...existing,
      status: input.status,
      safeError: input.status === "failed" ? input.safeError : undefined,
      updatedAt: new Date().toISOString(),
    };

    records.set(input.runId, next);
    return next;
  };

  const getRunById = async (runId: string) => {
    return records.get(runId);
  };

  const getByCorrelationId = (threadId: string, correlationId: string) => {
    for (const run of records.values()) {
      if (run.threadId === threadId && run.correlationId === correlationId) {
        return run;
      }
    }

    return;
  };

  return {
    createQueuedRun,
    updateRunStatus,
    getRunById,
    getByCorrelationId,
  };
};
