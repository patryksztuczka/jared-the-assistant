import { type AssistantResponse, type LlmService } from "../services/chat/llm-service";
import type { MessageService } from "../services/chat/message-service";
import type {
  AgentLoopStopReason,
  RunLoopEventService,
  RunLoopEventType,
} from "../services/chat/loop-event-service";
import type { ModelMessage } from "ai";

interface CreateAgentLoopOptions {
  llmService: LlmService;
  messageService: MessageService;
  runLoopEventService: RunLoopEventService;
  model: string;
  recentMessageCount: number;
  maxIterations: number;
}

interface RunAgentLoopInput {
  runId: string;
  threadId: string;
  message: ModelMessage;
}

export interface AgentLoopRunResult {
  output?: AssistantResponse;
  reason: AgentLoopStopReason;
  error?: string;
}

export class AgentLoop {
  private readonly llmService: LlmService;
  private readonly messageService: MessageService;
  private readonly runLoopEventService: RunLoopEventService;
  private readonly model: string;
  private readonly recentMessageCount: number;
  private readonly maxIterations: number;

  public constructor(options: CreateAgentLoopOptions) {
    this.llmService = options.llmService;
    this.messageService = options.messageService;
    this.model = options.model;
    this.recentMessageCount = options.recentMessageCount;
    this.maxIterations = options.maxIterations;
    this.runLoopEventService = options.runLoopEventService;
  }

  public async run(input: RunAgentLoopInput) {
    await this.emitEvent({
      runId: input.runId,
      eventType: "loop.started",
      payload: { threadId: input.threadId, prompt: input.message },
    });

    try {
      const recentMessages = await this.messageService.listMessagesByThreadId(
        input.threadId,
        this.recentMessageCount,
      );

      let output: AssistantResponse | undefined;
      let iterationsCalled = 0;

      do {
        output = await this.llmService.generateAssistantResponse({
          model: this.model,
          messages: [...recentMessages, input.message],
        });

        iterationsCalled += 1;

        await this.messageService.createAssistantMessage({
          threadId: input.threadId,
          content: output.response ?? "No content",
        });

        recentMessages.push({
          role: "assistant",
          content: output.response ?? "No content",
        });
      } while (iterationsCalled < this.maxIterations && output.action === "continue");

      if (!output) {
        throw new Error("Loop finished without assistant output");
      }

      const loopStopReason = output.action === "finish" ? "success" : "max_iterations_reached";

      await this.emitEvent({
        runId: input.runId,
        eventType: "loop.completed",
        payload: {
          output,
          reason: loopStopReason,
        },
      });

      return {
        output,
        reason: loopStopReason,
      } satisfies AgentLoopRunResult;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";

      await this.emitEvent({
        runId: input.runId,
        eventType: "loop.error",
        payload: { error: safeError, reason: "error" },
      });

      return {
        reason: "error" as const,
        error: safeError,
      } satisfies AgentLoopRunResult;
    }
  }

  private async emitEvent(input: { runId: string; eventType: RunLoopEventType; payload: unknown }) {
    await this.runLoopEventService.appendEvent({
      runId: input.runId,
      eventType: input.eventType,
      payload: input.payload,
    });
  }
}
