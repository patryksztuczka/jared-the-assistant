import { EVENT_TYPE, type AgentEvent, type AgentRunRequestedPayload } from "../events/types";
import type { StreamEntry } from "../events/redis-stream";
import type { ChatHistoryMessage, ChatMessageService } from "../services/chat/message-service";
import type { ChatRunService, RunStatus } from "../services/chat/run-service";
import {
  buildMemorySystemMessage,
  createFallbackChatLlmService,
  type ChatLlmService,
  type ChatPromptMessage,
} from "../services/chat/llm-service";

export interface RuntimeEventBus {
  publish(event: AgentEvent): Promise<void>;
  ensureConsumerGroup(groupName: string): Promise<void>;
  readGroup(
    groupName: string,
    consumerName: string,
    options?: { blockMs?: number; count?: number },
  ): Promise<StreamEntry[]>;
  acknowledge(groupName: string, streamEntryId: string): Promise<void>;
}

const GENERIC_RUNTIME_ERROR_MESSAGE = "Agent runtime failed to process the request.";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MEMORY_RECENT_MESSAGE_COUNT = 8;

interface AgentRuntimeOptions {
  bus: RuntimeEventBus;
  messageService?: ChatMessageService;
  runService?: ChatRunService;
  chatLlmService?: ChatLlmService;
  consumerGroup: string;
  consumerName: string;
  defaultModel?: string;
  summaryModel?: string;
  memoryRecentMessageCount?: number;
  logger?: Pick<Console, "info" | "error">;
}

export class AgentRuntime {
  private readonly bus: RuntimeEventBus;
  private readonly messageService?: ChatMessageService;
  private readonly runService?: ChatRunService;
  private readonly chatLlmService: ChatLlmService;
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private readonly defaultModel: string;
  private readonly summaryModel?: string;
  private readonly memoryRecentMessageCount: number;
  private readonly logger: Pick<Console, "info" | "error">;
  private isRunning = false;

  public constructor(options: AgentRuntimeOptions) {
    this.bus = options.bus;
    this.messageService = options.messageService;
    this.runService = options.runService;
    this.chatLlmService = options.chatLlmService ?? createFallbackChatLlmService();
    this.consumerGroup = options.consumerGroup;
    this.consumerName = options.consumerName;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.summaryModel = options.summaryModel;
    this.memoryRecentMessageCount = normalizeRecentMessageCount(options.memoryRecentMessageCount);
    this.logger = options.logger ?? console;
  }

  public async init() {
    await this.bus.ensureConsumerGroup(this.consumerGroup);
  }

  public start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    void this.poll();
  }

  public stop() {
    this.isRunning = false;
  }

  public async processOnce() {
    const entries = await this.bus.readGroup(this.consumerGroup, this.consumerName);
    if (entries.length === 0) {
      return 0;
    }

    for (const entry of entries) {
      await this.processEntry(entry.streamEntryId, entry.event);
    }

    return entries.length;
  }

  private async poll() {
    while (this.isRunning) {
      try {
        await this.processOnce();
      } catch (error) {
        this.logger.error("runtime.poll.error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  private async processEntry(streamEntryId: string, event: AgentEvent) {
    if (event.type !== EVENT_TYPE.AGENT_RUN_REQUESTED) {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
      return;
    }

    const requestedEvent = event as AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>;
    const payload = requestedEvent.payload as AgentRunRequestedPayload;

    try {
      await this.updateRunStatus(payload.runId, "processing");
      const completedEvent = await this.buildCompletedEvent(requestedEvent);
      await this.persistAssistantMessage(requestedEvent, completedEvent.payload.output);
      await this.bus.publish(completedEvent);
      await this.updateRunStatus(payload.runId, "completed");

      this.logger.info("runtime.event.processed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } catch {
      const failedEvent = this.buildFailedEvent(requestedEvent);
      await this.bus.publish(failedEvent);
      await this.updateRunStatus(payload.runId, "failed", GENERIC_RUNTIME_ERROR_MESSAGE);

      this.logger.error("runtime.event.failed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } finally {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
    }
  }

  private async updateRunStatus(runId: string, status: RunStatus, safeError?: string) {
    if (!this.runService) {
      return;
    }

    await this.runService.updateRunStatus({
      runId,
      status,
      safeError,
    });
  }

  private async buildCompletedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    const payload = event.payload as AgentRunRequestedPayload;
    if (payload.simulateFailure) {
      throw new Error("Simulated runtime failure");
    }

    const output = await this.generateAssistantOutput(event);

    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_COMPLETED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        output,
      },
    };
  }

  private async generateAssistantOutput(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    const payload = event.payload as AgentRunRequestedPayload;
    const model = payload.model || this.defaultModel;
    const threadMessages = await this.getThreadMessages(payload.threadId);
    const recentMessages = buildRecentPromptMessages(threadMessages, this.memoryRecentMessageCount);

    const hasCurrentPromptMessage = threadMessages.some((message) => {
      return message.correlationId === event.correlationId && message.role === "user";
    });

    if (!hasCurrentPromptMessage) {
      recentMessages.push({
        role: "user",
        content: payload.prompt,
      });
    }

    const olderMessages = buildOlderPromptMessages(threadMessages, this.memoryRecentMessageCount);
    const summaryModel = this.summaryModel || model;

    if (olderMessages.length > 0) {
      const summary = await this.chatLlmService.summarizeConversation({
        model: summaryModel,
        messages: olderMessages,
      });

      if (summary) {
        return this.chatLlmService.generateAssistantResponse({
          model,
          messages: [buildMemorySystemMessage(summary), ...recentMessages],
        });
      }
    }

    if (recentMessages.length === 0) {
      recentMessages.push({
        role: "user",
        content: payload.prompt,
      });
    }

    return this.chatLlmService.generateAssistantResponse({
      model,
      messages: recentMessages,
    });
  }

  private async getThreadMessages(threadId: string) {
    if (!this.messageService) {
      return [];
    }

    return this.messageService.listMessagesByThreadId(threadId);
  }

  private async persistAssistantMessage(
    event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>,
    output: string,
  ) {
    if (!this.messageService) {
      return;
    }

    const payload = event.payload as AgentRunRequestedPayload;

    await this.messageService.createAssistantMessage({
      threadId: payload.threadId,
      content: output,
      correlationId: event.correlationId,
    });
  }

  private buildFailedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_FAILED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        error: GENERIC_RUNTIME_ERROR_MESSAGE,
      },
    };
  }
}

const normalizeRecentMessageCount = (value: number | undefined) => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_MEMORY_RECENT_MESSAGE_COUNT;
  }

  return Math.max(1, Math.floor(value));
};

const toPromptMessage = (message: ChatHistoryMessage) => {
  return {
    role: message.role,
    content: message.content,
  } satisfies ChatPromptMessage;
};

const buildRecentPromptMessages = (messages: ChatHistoryMessage[], recentMessageCount: number) => {
  if (messages.length <= recentMessageCount) {
    return messages.map((message) => {
      return toPromptMessage(message);
    });
  }

  return messages.slice(-recentMessageCount).map((message) => {
    return toPromptMessage(message);
  });
};

const buildOlderPromptMessages = (messages: ChatHistoryMessage[], recentMessageCount: number) => {
  if (messages.length <= recentMessageCount) {
    return [];
  }

  return messages.slice(0, -recentMessageCount).map((message) => {
    return toPromptMessage(message);
  });
};
