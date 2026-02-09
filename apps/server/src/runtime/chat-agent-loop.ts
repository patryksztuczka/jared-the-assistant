import {
  AgentLoop,
  createInMemoryAgentLoopCheckpointStore,
  type AgentLoopCheckpointStore,
  type AgentLoopEventEmitter,
  type AgentLoopStopReason,
} from "./agent-loop-core";
import {
  buildMemorySystemMessage,
  type ChatLlmService,
  type ChatPromptMessage,
} from "../services/chat/llm-service";
import type { ChatHistoryMessage, ChatMessageService } from "../services/chat/message-service";

const DEFAULT_MEMORY_RECENT_MESSAGE_COUNT = 8;
const DEFAULT_MAX_ITERATIONS = 1;

interface ChatAgentLoopState {
  threadId: string;
  correlationId: string;
  prompt: string;
  model: string;
  output?: string;
}

interface ChatAgentLoopStep {
  type: "respond";
  model: string;
}

interface ChatAgentLoopObservation {
  output: string;
}

interface CreateChatAgentLoopOptions {
  chatLlmService: ChatLlmService;
  messageService?: ChatMessageService;
  defaultModel: string;
  summaryModel?: string;
  memoryRecentMessageCount?: number;
  maxIterations?: number;
  checkpointStore?: AgentLoopCheckpointStore<ChatAgentLoopState>;
  eventEmitter?: AgentLoopEventEmitter<
    ChatAgentLoopState,
    ChatAgentLoopStep,
    ChatAgentLoopObservation
  >;
}

interface RunChatAgentLoopInput {
  sessionId: string;
  threadId: string;
  correlationId: string;
  prompt: string;
  model?: string;
}

export interface ChatAgentLoopRunResult {
  output?: string;
  reason: AgentLoopStopReason;
  iterations: number;
  error?: string;
}

export class ChatAgentLoop {
  private readonly chatLlmService: ChatLlmService;
  private readonly messageService?: ChatMessageService;
  private readonly defaultModel: string;
  private readonly summaryModel?: string;
  private readonly memoryRecentMessageCount: number;
  private readonly maxIterations: number;
  private readonly loop: AgentLoop<ChatAgentLoopState, ChatAgentLoopStep, ChatAgentLoopObservation>;

  public constructor(options: CreateChatAgentLoopOptions) {
    this.chatLlmService = options.chatLlmService;
    this.messageService = options.messageService;
    this.defaultModel = options.defaultModel;
    this.summaryModel = options.summaryModel;
    this.memoryRecentMessageCount = normalizeRecentMessageCount(options.memoryRecentMessageCount);
    this.maxIterations = normalizeMaxIterations(options.maxIterations);

    this.loop = new AgentLoop({
      planner: {
        plan: async ({ state }) => {
          return {
            type: "respond",
            model: state.model,
          } satisfies ChatAgentLoopStep;
        },
      },
      executor: {
        execute: async ({ state }) => {
          const output = await this.generateAssistantOutput(state);
          return { output } satisfies ChatAgentLoopObservation;
        },
      },
      evaluator: {
        evaluate: async ({ state, observation }) => {
          const output = observation.output.trim();

          if (!output) {
            return {
              decision: "finish",
              reason: "no_progress",
              nextState: {
                ...state,
                output,
              },
            };
          }

          return {
            decision: "finish",
            reason: "success",
            nextState: {
              ...state,
              output,
            },
          };
        },
      },
      checkpointStore:
        options.checkpointStore ?? createInMemoryAgentLoopCheckpointStore<ChatAgentLoopState>(),
      eventEmitter: options.eventEmitter,
    });
  }

  public async run(input: RunChatAgentLoopInput) {
    const initialState = {
      threadId: input.threadId,
      correlationId: input.correlationId,
      prompt: input.prompt,
      model: input.model || this.defaultModel,
      output: undefined,
    } satisfies ChatAgentLoopState;

    const result = await this.loop.run({
      sessionId: input.sessionId,
      initialState,
      maxIterations: this.maxIterations,
      resumeFromCheckpoint: false,
    });

    return {
      output: result.state.output,
      reason: result.reason,
      iterations: result.iterations,
      error: result.error,
    } satisfies ChatAgentLoopRunResult;
  }

  private async generateAssistantOutput(state: ChatAgentLoopState) {
    const threadMessages = await this.getThreadMessages(state.threadId);
    const recentMessages = buildRecentPromptMessages(threadMessages, this.memoryRecentMessageCount);

    const hasCurrentPromptMessage = threadMessages.some((message) => {
      return message.correlationId === state.correlationId && message.role === "user";
    });

    if (!hasCurrentPromptMessage) {
      recentMessages.push({
        role: "user",
        content: state.prompt,
      });
    }

    const olderMessages = buildOlderPromptMessages(threadMessages, this.memoryRecentMessageCount);
    const summaryModel = this.summaryModel || state.model;

    if (olderMessages.length > 0) {
      const summary = await this.chatLlmService.summarizeConversation({
        model: summaryModel,
        messages: olderMessages,
      });

      if (summary) {
        return this.chatLlmService.generateAssistantResponse({
          model: state.model,
          messages: [buildMemorySystemMessage(summary), ...recentMessages],
        });
      }
    }

    if (recentMessages.length === 0) {
      recentMessages.push({
        role: "user",
        content: state.prompt,
      });
    }

    return this.chatLlmService.generateAssistantResponse({
      model: state.model,
      messages: recentMessages,
    });
  }

  private async getThreadMessages(threadId: string) {
    if (!this.messageService) {
      return [];
    }

    return this.messageService.listMessagesByThreadId(threadId);
  }
}

const normalizeRecentMessageCount = (value: number | undefined) => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_MEMORY_RECENT_MESSAGE_COUNT;
  }

  return Math.max(1, Math.floor(value));
};

const normalizeMaxIterations = (value: number | undefined) => {
  if (!value || Number.isNaN(value) || value < 1) {
    return DEFAULT_MAX_ITERATIONS;
  }

  return Math.floor(value);
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
