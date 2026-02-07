import { describe, expect, test } from "bun:test";
import { OutboxPublisher } from "../../../src/events/outbox-publisher";
import { createInMemoryOutboxService } from "../../../src/services/events/outbox-service";
import { EVENT_TYPE, type AgentEvent, type EventPublisher } from "../../../src/events/types";

const createRequestedEvent = (id: string): AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED> => {
  return {
    id,
    type: EVENT_TYPE.AGENT_RUN_REQUESTED,
    timestamp: "2026-01-01T00:00:00.000Z",
    correlationId: `corr_${id}`,
    payload: {
      runId: `run_${id}`,
      threadId: "thr_abcdefghijklmnopqrstuvwx",
      prompt: "hello",
    },
  };
};

describe("OutboxPublisher", () => {
  test("publishes pending outbox events and marks them published", async () => {
    const outboxService = createInMemoryOutboxService();
    const publishedEvents: AgentEvent[] = [];
    const publisher: EventPublisher = {
      publish: async (event) => {
        publishedEvents.push(event);
      },
    };

    const event = createRequestedEvent("evt_outbox_1");
    await outboxService.createPendingEvent({ event });

    const worker = new OutboxPublisher({
      outboxService,
      publisher,
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await worker.processOnce();

    expect(processed).toBe(1);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual(event);

    const outboxRecord = outboxService.getById(event.id);
    expect(outboxRecord?.status).toBe("published");
    expect(outboxRecord?.attempts).toBe(0);
    expect(typeof outboxRecord?.publishedAt).toBe("string");
    expect(Number.isNaN(Date.parse(outboxRecord?.publishedAt ?? ""))).toBe(false);
  });

  test("marks failed publish as retryable and increments attempts", async () => {
    const outboxService = createInMemoryOutboxService();
    const publisher: EventPublisher = {
      publish: async () => {
        throw new Error("redis unavailable");
      },
    };

    const event = createRequestedEvent("evt_outbox_2");
    await outboxService.createPendingEvent({ event });

    const worker = new OutboxPublisher({
      outboxService,
      publisher,
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await worker.processOnce();

    expect(processed).toBe(1);
    const outboxRecord = outboxService.getById(event.id);
    expect(outboxRecord?.status).toBe("failed");
    expect(outboxRecord?.attempts).toBe(1);
    expect(outboxRecord?.lastError).toBe("redis unavailable");

    const retryableEvents = await outboxService.listRetryableEvents(10);
    expect(retryableEvents.map((record) => record.id)).toContain(event.id);
  });
});
