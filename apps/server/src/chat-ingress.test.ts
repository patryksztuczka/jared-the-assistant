import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { ChatMessageStore } from "./chat/message-store";
import { EVENT_TYPE, type AgentEvent, type EventPublisher } from "./events/types";

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
  const store: ChatMessageStore = {
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
    store,
    calls,
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
    const { store, calls } = createStoreSpy();

    const publisher: EventPublisher = {
      publish: async (event) => {
        callOrder.push("publish");
        publishedEvents.push(event);
      },
    };

    const app = createApp({
      publisher,
      messageStore: {
        createIncomingMessage: async (input) => {
          callOrder.push("store");
          return store.createIncomingMessage(input);
        },
        createAssistantMessage: async (input) => {
          return store.createAssistantMessage(input);
        },
        listMessagesByThreadId: async (threadId) => {
          return store.listMessagesByThreadId(threadId);
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
          threadId: string;
          messageId: string;
          correlationId: string;
        }
      | undefined;

    expect(res.status).toBe(202);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(true);
    expect(body?.status).toBe("accepted");
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
    expect(callOrder).toEqual(["store", "publish"]);
  });

  test("rejects invalid payload and does not persist nor publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const { store, calls } = createStoreSpy();

    const app = createApp({
      publisher,
      messageStore: store,
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
    expect(publishedEvents).toHaveLength(0);
  });

  test("rejects missing content and does not persist nor publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const { store, calls } = createStoreSpy();

    const app = createApp({
      publisher,
      messageStore: store,
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
    expect(publishedEvents).toHaveLength(0);
  });
});
