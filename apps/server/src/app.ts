import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { createInMemoryChatMessageStore, type ChatMessageStore } from "./chat/message-store";
import {
  EVENT_TYPE,
  parseCreateChatMessageRequest,
  type EventPublisher,
} from "./events/types";

interface CreateAppOptions {
  publisher: EventPublisher;
  messageStore?: ChatMessageStore;
}

export const createApp = (options: CreateAppOptions) => {
  const app = new Hono();
  const messageStore = options.messageStore ?? createInMemoryChatMessageStore();

  app.get("/api", (c) => {
    return c.json({ ok: true, message: "API is running" });
  });

  app.post("/api/chat/messages", async (c) => {
    const body: unknown = await c.req.json().catch(() => {
      return;
    });
    const request = parseCreateChatMessageRequest(body);

    if (!request) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid request body. Expected { content: string, threadId?: 'thr_<24 lowercase alphanumerics>' }",
        },
        400,
      );
    }

    const threadId = request.threadId ?? `thr_${createId()}`;
    const correlationId = request.correlationId ?? crypto.randomUUID();
    const persistedMessage = await messageStore.createIncomingMessage({
      threadId,
      content: request.content,
      correlationId,
    });

    await options.publisher.publish({
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_REQUESTED,
      timestamp: new Date().toISOString(),
      correlationId,
      payload: {
        prompt: request.content,
      },
    });

    return c.json(
      {
        ok: true,
        status: "accepted",
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        correlationId,
      },
      202,
    );
  });

  return app;
};

const noopPublisher: EventPublisher = {
  publish: async () => {
    return;
  },
};

export const app = createApp({ publisher: noopPublisher });
