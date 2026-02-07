import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import { createEnvironmentChatModelCatalogService } from "../../src/services/chat/model-catalog-service";
import type { ChatMessageService } from "../../src/services/chat/message-service";
import type { ChatRunService } from "../../src/services/chat/run-service";
import { EVENT_TYPE, type AgentEvent, type EventPublisher } from "../../src/events/types";

const createPublisherSpy = () => {
  const publishedEvents: AgentEvent[] = [];
  const publisher: EventPublisher = {
    publish: async (event) => {
      publishedEvents.push(event);
    },
  };

  return {
    publisher,
    publishedEvents,
  };
};

const createStoreSpy = () => {
  const calls: Array<{ threadId: string; content: string; correlationId: string }> = [];
  const messageService: ChatMessageService = {
    createIncomingMessage: async (input) => {
      calls.push(input);
      return {
        messageId: "msg_123",
        threadId: input.threadId,
      };
    },
    createAssistantMessage: async (input) => {
      return {
        messageId: `msg_assistant_${input.correlationId}`,
        threadId: input.threadId,
      };
    },
    listMessagesByThreadId: async () => {
      return [];
    },
  };

  return {
    messageService,
    calls,
  };
};

const createRunServiceSpy = () => {
  const createQueuedRunCalls: Array<{ id: string; threadId: string; correlationId: string }> = [];
  const runService: ChatRunService = {
    createQueuedRun: async (input) => {
      createQueuedRunCalls.push(input);

      return {
        id: input.id,
        threadId: input.threadId,
        correlationId: input.correlationId,
        status: "queued",
        safeError: undefined,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
    },
    updateRunStatus: async () => {
      throw new Error("updateRunStatus should not be called in ingress test");
    },
    getRunById: async () => {
      return undefined;
    },
  };

  return {
    runService,
    createQueuedRunCalls,
  };
};

const readJsonIfPresent = async (res: Response) => {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return;
  }

  return (await res.json()) as unknown;
};

describe("POST /api/chat/messages", () => {
  test("persists user message before publishing runtime event", async () => {
    const callOrder: string[] = [];
    const { publishedEvents } = createPublisherSpy();
    const { messageService, calls } = createStoreSpy();
    const { runService, createQueuedRunCalls } = createRunServiceSpy();

    const publisher: EventPublisher = {
      publish: async (event) => {
        callOrder.push("publish");
        publishedEvents.push(event);
      },
    };

    const app = createApp({
      publisher,
      runService,
      messageService: {
        createIncomingMessage: async (input) => {
          callOrder.push("store");
          return messageService.createIncomingMessage(input);
        },
        createAssistantMessage: async (input) => {
          return messageService.createAssistantMessage(input);
        },
        listMessagesByThreadId: async (threadId) => {
          return messageService.listMessagesByThreadId(threadId);
        },
      },
    });

    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Summarize this incident.",
      }),
    });

    const body = (await readJsonIfPresent(res)) as
      | {
          ok: boolean;
          status: string;
          runId: string;
          threadId: string;
          messageId: string;
          correlationId: string;
        }
      | undefined;

    expect(res.status).toBe(202);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(true);
    expect(body?.status).toBe("accepted");
    expect(typeof body?.runId).toBe("string");
    expect(body?.runId).toMatch(/^run_[a-z0-9]{24}$/);
    expect(typeof body?.threadId).toBe("string");
    expect(body?.threadId).toMatch(/^thr_[a-z0-9]{24}$/);
    expect(body?.messageId).toBe("msg_123");
    expect(typeof body?.correlationId).toBe("string");
    expect(body?.correlationId.length).toBeGreaterThan(0);
    const correlationId = body?.correlationId;
    if (!correlationId) {
      throw new Error("correlationId should be present");
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      threadId: body?.threadId,
      content: "Summarize this incident.",
      correlationId,
    });

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_REQUESTED);
    expect(publishedEvents[0]?.correlationId).toBe(correlationId);
    expect(createQueuedRunCalls).toEqual([
      {
        id: body?.runId ?? "",
        threadId: body?.threadId,
        correlationId,
      },
    ]);
    expect(callOrder).toEqual(["store", "publish"]);
  });

  test("rejects invalid payload and does not persist nor publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const { messageService, calls } = createStoreSpy();
    const { runService, createQueuedRunCalls } = createRunServiceSpy();

    const app = createApp({
      publisher,
      runService,
      messageService,
      modelCatalogService: createEnvironmentChatModelCatalogService({
        CHAT_ALLOWED_MODELS: "gpt-4o-mini,gpt-4.1-mini",
      }),
    });

    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "thread_1",
        content: "hello",
      }),
    });

    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
    expect(calls).toHaveLength(0);
    expect(createQueuedRunCalls).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test("rejects missing content and does not persist nor publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const { messageService, calls } = createStoreSpy();
    const { runService, createQueuedRunCalls } = createRunServiceSpy();

    const app = createApp({
      publisher,
      runService,
      messageService,
      modelCatalogService: createEnvironmentChatModelCatalogService({
        CHAT_ALLOWED_MODELS: "gpt-4o-mini,gpt-4.1-mini",
      }),
    });

    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        threadId: "thr_abcdefghijklmnopqrstuvwx",
      }),
    });

    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
    expect(calls).toHaveLength(0);
    expect(createQueuedRunCalls).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });

  test("rejects unsupported model and does not persist nor publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const { messageService, calls } = createStoreSpy();
    const { runService, createQueuedRunCalls } = createRunServiceSpy();

    const app = createApp({
      publisher,
      runService,
      messageService,
      modelCatalogService: createEnvironmentChatModelCatalogService({
        CHAT_ALLOWED_MODELS: "gpt-4o-mini,gpt-4.1-mini",
      }),
    });

    const res = await app.request("/api/chat/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Implement this API",
        model: "unsupported-model",
      }),
    });

    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
    expect(body?.error).toContain("Unsupported model");
    expect(calls).toHaveLength(0);
    expect(createQueuedRunCalls).toHaveLength(0);
    expect(publishedEvents).toHaveLength(0);
  });
});
