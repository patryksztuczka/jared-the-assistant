import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import type { ChatMessageService } from "../../src/services/chat/message-service";
import type { EventPublisher } from "../../src/events/types";

interface ChatHistoryMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  correlationId: string;
  createdAt: string;
}

interface ChatHistoryService extends ChatMessageService {
  listMessagesByThreadId(threadId: string): Promise<ChatHistoryMessage[]>;
}

const createPublisherSpy = () => {
  const publisher: EventPublisher = {
    publish: async () => {
      return;
    },
  };

  return { publisher };
};

const readJsonIfPresent = async (res: Response) => {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return;
  }

  return (await res.json()) as unknown;
};

describe("GET /api/chat/threads/:threadId/messages", () => {
  test("returns 200 with ordered messages for an existing thread", async () => {
    const { publisher } = createPublisherSpy();
    const requestedThreadId = "thr_abcdefghijklmnopqrstuvwx";
    const listCalls: string[] = [];

    const messageService: ChatHistoryService = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      createAssistantMessage: async (input) => {
        return {
          messageId: `msg_assistant_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      listMessagesByThreadId: async (threadId) => {
        listCalls.push(threadId);
        return [
          {
            id: "msg_1",
            threadId,
            role: "user",
            content: "First",
            correlationId: "corr_1",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "msg_2",
            threadId,
            role: "assistant",
            content: "Second",
            correlationId: "corr_2",
            createdAt: "2026-01-01T00:00:02.000Z",
          },
          {
            id: "msg_3",
            threadId,
            role: "assistant",
            content: "Third",
            correlationId: "corr_3",
            createdAt: "2026-01-01T00:00:03.000Z",
          },
        ];
      },
    };

    const app = createApp({
      publisher,
      messageService,
    });

    const res = await app.request(`/api/chat/threads/${requestedThreadId}/messages`);
    const body = (await readJsonIfPresent(res)) as
      | {
          ok: boolean;
          messages: ChatHistoryMessage[];
        }
      | undefined;

    expect(res.status).toBe(200);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(true);
    expect(listCalls).toEqual([requestedThreadId]);
    expect(body?.messages.map((message) => message.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(body?.messages.map((message) => message.createdAt)).toEqual([
      "2026-01-01T00:00:01.000Z",
      "2026-01-01T00:00:02.000Z",
      "2026-01-01T00:00:03.000Z",
    ]);
    expect(body?.messages[0]).toEqual({
      id: "msg_1",
      threadId: requestedThreadId,
      role: "user",
      content: "First",
      correlationId: "corr_1",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
  });

  test("returns 200 with an empty list for a thread with no messages", async () => {
    const { publisher } = createPublisherSpy();
    const requestedThreadId = "thr_abcdefghijklmnopqrstuvwx";

    const messageService: ChatHistoryService = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_${input.correlationId}`,
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

    const app = createApp({
      publisher,
      messageService,
    });

    const res = await app.request(`/api/chat/threads/${requestedThreadId}/messages`);
    const body = (await readJsonIfPresent(res)) as
      | {
          ok: boolean;
          messages: ChatHistoryMessage[];
        }
      | undefined;

    expect(res.status).toBe(200);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(true);
    expect(body?.messages).toEqual([]);
  });

  test("returns 400 for an invalid threadId format", async () => {
    const { publisher } = createPublisherSpy();

    const messageService: ChatHistoryService = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_${input.correlationId}`,
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

    const app = createApp({
      publisher,
      messageService,
    });

    const res = await app.request("/api/chat/threads/thread_1/messages");
    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body).toBeDefined();
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
  });
});
