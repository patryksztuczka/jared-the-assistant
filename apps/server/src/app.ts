import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import { upgradeWebSocket } from "hono/bun";
import {
  createChatMessageRequestSchema,
  type MessageService,
} from "./modules/messages/messages-schemas";
import { DEFAULT_MODEL } from "./lib/constants";
import type { EventBus } from "./event-bus/redis-stream";
import { EVENT_TYPE } from "./event-bus/types";
import type { RunService } from "./modules/runs/runs-schemas";
import type { RunStreamService } from "./agent/run-stream-service";

export { websocket } from "hono/bun";

interface CreateAppOptions {
  eventBus: EventBus;
  messageService: MessageService;
  runService: RunService;
  runStreamService: RunStreamService;
}

export const createApp = (options: CreateAppOptions) => {
  const app = new Hono();
  const messageService = options.messageService;
  const eventBus = options.eventBus;
  const runService = options.runService;
  const runStreamService = options.runStreamService;

  const threadIdPattern = /^thr_[a-z0-9]{24}$/;

  app.get("/api", (c) => {
    return c.json({ ok: true, message: "API is running" });
  });

  app.post("/api/chat/messages", async (c) => {
    const body: unknown = await c.req.json().catch(() => {
      return;
    });

    const parsedRequest = createChatMessageRequestSchema.safeParse(body);

    if (!parsedRequest.success) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid request body. Expected { content: string, model?: string, threadId?: 'thr_<24 lowercase alphanumerics>' }",
        },
        400,
      );
    }

    const request = parsedRequest.data;

    const threadId = request.threadId ?? `thr_${createId()}`;
    const runId = `run_${createId()}`;
    const model = request.model;

    const persistedMessage = await messageService.createIncomingMessage({
      threadId,
      content: request.content,
    });

    await runService.createQueuedRun({
      runId,
      threadId: persistedMessage.threadId,
    });

    await eventBus.publish({
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_REQUESTED,
      timestamp: new Date().toISOString(),
      payload: {
        runId,
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        model: model ?? DEFAULT_MODEL,
        message: {
          role: "user",
          content: request.content,
        },
      },
    });

    return c.json(
      {
        ok: true,
        status: "accepted",
        runId,
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        model: model ?? DEFAULT_MODEL,
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

    const messages = await messageService.listMessagesByThreadId(threadId);

    return c.json({
      ok: true,
      messages,
    });
  });

  app.get(
    "/ws/runs/:runId",
    upgradeWebSocket((c) => {
      const runId = c.req.param("runId");
      let unsubscribe: (() => void) | undefined;

      return {
        onOpen(_, ws) {
          unsubscribe = runStreamService.subscribe(runId, (event) => {
            ws.send(JSON.stringify(event));
          });

          ws.send(
            JSON.stringify({
              type: "connection.ready",
              payload: {
                runId,
              },
            }),
          );
        },
        onClose() {
          unsubscribe?.();
        },
        onError() {
          unsubscribe?.();
        },
      };
    }),
  );

  return app;
};
