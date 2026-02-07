import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { createDrizzleChatIngressService } from "../../../src/services/chat/ingress-service";
import * as schema from "../../../db/schema";
import { messages, outboxEvents, runs } from "../../../db/schema";

describe("createDrizzleChatIngressService", () => {
  test("inserts message and outbox row atomically in one transaction", async () => {
    const databaseFilePath = `/tmp/jared-ingress-${crypto.randomUUID()}.sqlite`;
    const database = drizzle({
      connection: {
        url: `file:${databaseFilePath}`,
      },
      schema,
    });

    try {
      await migrate(database, {
        migrationsFolder: `${process.cwd()}/db/migrations`,
      });

      await database.insert(outboxEvents).values({
        id: "evt_conflict",
        eventType: "agent.run.requested",
        payload: JSON.stringify({ ok: true }),
        status: "pending",
      });

      const ingressService = createDrizzleChatIngressService(database);

      await expect(
        ingressService.createIncomingMessageAndQueueRun({
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          runId: "run_abcdefghijklmnopqrstuvwx",
          content: "hello",
          correlationId: "corr_1",
          eventId: "evt_conflict",
        }),
      ).rejects.toThrow();

      const persistedMessages = await database
        .select()
        .from(messages)
        .where(eq(messages.correlationId, "corr_1"));
      const persistedRuns = await database
        .select()
        .from(runs)
        .where(eq(runs.correlationId, "corr_1"));

      expect(persistedMessages).toHaveLength(0);
      expect(persistedRuns).toHaveLength(0);
    } finally {
      await Bun.file(databaseFilePath).delete();
    }
  });
});
