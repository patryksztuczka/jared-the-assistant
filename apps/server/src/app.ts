import { Hono } from "hono";
import { createId } from "@paralleldrive/cuid2";
import {
  createInMemoryChatMessageService,
  type ChatMessageService,
} from "./services/chat/message-service";
import { createInMemoryChatRunService, type ChatRunService } from "./services/chat/run-service";
import type { ChatIngressService } from "./services/chat/ingress-service";
import {
  createEnvironmentChatModelCatalogService,
  type ChatModelCatalogService,
} from "./services/chat/model-catalog-service";
import { EVENT_TYPE, parseCreateChatMessageRequest, type EventPublisher } from "./events/types";

interface CreateAppOptions {
  publisher?: EventPublisher;
  ingressService?: ChatIngressService;
  messageService?: ChatMessageService;
  runService?: ChatRunService;
  modelCatalogService?: ChatModelCatalogService;
}

export const createApp = (options: CreateAppOptions) => {
  const app = new Hono();
  const messageService = options.messageService ?? createInMemoryChatMessageService();
  const runService = options.runService ?? createInMemoryChatRunService();
  const ingressService = options.ingressService;
  const modelCatalogService =
    options.modelCatalogService ?? createEnvironmentChatModelCatalogService();
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
            "Invalid request body. Expected { content: string, model?: string, threadId?: 'thr_<24 lowercase alphanumerics>' }",
        },
        400,
      );
    }

    const modelResolution = modelCatalogService.resolveModel(request.model);
    if (!modelResolution.model) {
      return c.json(
        {
          ok: false,
          error: modelResolution.error ?? "Unsupported model",
        },
        400,
      );
    }

    const model = modelResolution.model;

    const threadId = request.threadId ?? `thr_${createId()}`;
    const runId = `run_${createId()}`;
    const correlationId = request.correlationId ?? crypto.randomUUID();

    const persistedMessage = ingressService
      ? await ingressService.createIncomingMessageAndQueueRun({
          threadId,
          runId,
          content: request.content,
          model,
          correlationId,
        })
      : await messageService.createIncomingMessage({
          threadId,
          content: request.content,
          correlationId,
        });

    if (!ingressService) {
      await runService.createQueuedRun({
        id: runId,
        threadId,
        correlationId,
      });

      if (!options.publisher) {
        throw new Error("publisher is required when ingressService is not configured");
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
          model,
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
        model,
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

    const messages = await messageService.listMessagesByThreadId(threadId);

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

    const run = await runService.getRunById(runId);
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
