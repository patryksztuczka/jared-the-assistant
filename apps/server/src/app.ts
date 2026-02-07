import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { createInMemoryChatMessageStore, type ChatMessageStore } from "./chat/message-store";
import { createInMemoryChatRunStore, type ChatRunStore } from "./chat/run-store";
import type { ChatIngressStore } from "./chat/ingress-store";
import { EVENT_TYPE, parseCreateChatMessageRequest, type EventPublisher } from "./events/types";

interface CreateAppOptions {
  publisher?: EventPublisher;
  ingressStore?: ChatIngressStore;
  messageStore?: ChatMessageStore;
  runStore?: ChatRunStore;
}

export const createApp = (options: CreateAppOptions) => {
  const app = new Hono();
  const messageStore = options.messageStore ?? createInMemoryChatMessageStore();
  const runStore = options.runStore ?? createInMemoryChatRunStore();
  const ingressStore = options.ingressStore;
  const threadIdPattern = /^thr_[a-z0-9]{24}$/;
  const runIdPattern = /^run_[a-z0-9]{24}$/;

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
    const runId = `run_${createId()}`;
    const correlationId = request.correlationId ?? crypto.randomUUID();

    const persistedMessage = ingressStore
      ? await ingressStore.createIncomingMessageAndQueueRun({
          threadId,
          runId,
          content: request.content,
          correlationId,
        })
      : await messageStore.createIncomingMessage({
          threadId,
          content: request.content,
          correlationId,
        });

    if (!ingressStore) {
      await runStore.createQueuedRun({
        id: runId,
        threadId,
        correlationId,
      });

      if (!options.publisher) {
        throw new Error("publisher is required when ingressStore is not configured");
      }

      await options.publisher.publish({
        id: crypto.randomUUID(),
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
          runId,
          threadId: persistedMessage.threadId,
          prompt: request.content,
        },
      });
    }

    return c.json(
      {
        ok: true,
        status: "accepted",
        runId,
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        correlationId,
      },
      202,
    );
  });

  app.get("/api/chat/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!threadIdPattern.test(threadId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid threadId. Expected format: thr_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    const messages = await messageStore.listMessagesByThreadId(threadId);

    return c.json({
      ok: true,
      messages,
    });
  });

  app.get("/api/chat/runs/:runId", async (c) => {
    const runId = c.req.param("runId");
    if (!runIdPattern.test(runId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid runId. Expected format: run_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    const run = await runStore.getRunById(runId);
    if (!run) {
      return c.json(
        {
          ok: false,
          error: "Run not found",
        },
        404,
      );
    }

    return c.json({
      ok: true,
      run,
    });
  });

  return app;
};

const noopPublisher: EventPublisher = {
  publish: async () => {
    return;
  },
};

export const app = createApp({ publisher: noopPublisher });
