import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GenerateAssistantResponseInput {
  model: string;
  messages: ChatPromptMessage[];
}

interface SummarizeConversationInput {
  model: string;
  previousSummary?: string;
  messages: ChatPromptMessage[];
}

export interface ChatLlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<string>;
  summarizeConversation(input: SummarizeConversationInput): Promise<string>;
}

const mapMessagesToCoreMessages = (messages: ChatPromptMessage[]) => {
  return messages.map((message) => {
    return {
      role: message.role,
      content: message.content,
    } satisfies ModelMessage;
  });
};

const SUMMARIZATION_INSTRUCTION =
  "You maintain compact memory for a chat thread. Summarize durable goals, decisions, constraints, open questions, and useful facts. Keep it concise and factual.";

const ASSISTANT_MEMORY_INSTRUCTION =
  "Use the conversation summary as persistent context, then prioritize the recent messages for immediate intent.";

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const result = await generateText({
    model: openai(input.model),
    messages: mapMessagesToCoreMessages(input.messages),
  });

  return result.text.trim();
};

const summarizeConversationWithAiSdk = async (input: SummarizeConversationInput) => {
  const summaryPromptParts = [
    input.previousSummary
      ? `Existing summary:\n${input.previousSummary}`
      : "Existing summary: (none)",
    "Messages to fold into memory:",
    ...input.messages.map((message) => {
      return `${message.role.toUpperCase()}: ${message.content}`;
    }),
    "Return only the updated summary in plain text.",
  ];

  const result = await generateText({
    model: openai(input.model),
    messages: [
      {
        role: "system",
        content: SUMMARIZATION_INSTRUCTION,
      },
      {
        role: "user",
        content: summaryPromptParts.join("\n\n"),
      },
    ],
  });

  return result.text.trim();
};

const summarizeConversationWithFallback = async (input: SummarizeConversationInput) => {
  const transcript = input.messages
    .map((message) => {
      return `${message.role}: ${message.content}`;
    })
    .join("\n");

  const prefix = input.previousSummary ? `${input.previousSummary}\n` : "";
  return `${prefix}${transcript}`.trim();
};

const generateAssistantResponseWithFallback = async (input: GenerateAssistantResponseInput) => {
  const lastUserMessage = input.messages.toReversed().find((message) => message.role === "user");

  return `Handled prompt: ${lastUserMessage?.content ?? ""}`;
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
    summarizeConversation: summarizeConversationWithAiSdk,
  } satisfies ChatLlmService;
};

export const createFallbackChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithFallback,
    summarizeConversation: summarizeConversationWithFallback,
  } satisfies ChatLlmService;
};

export const buildMemorySystemMessage = (summary: string) => {
  return {
    role: "system",
    content: `${ASSISTANT_MEMORY_INSTRUCTION}\n\nConversation summary:\n${summary}`,
  } satisfies ChatPromptMessage;
};
