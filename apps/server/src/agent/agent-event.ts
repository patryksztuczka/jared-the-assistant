import type { AssistantModelMessage, ToolModelMessage } from "ai";

export type AgentLoopEvent =
  | { type: "agent.start"; model: string }
  | { type: "agent.token"; delta: string; iteration: number }
  | { type: "tool.start"; toolName: string; iteration: number }
  | { type: "tool.end"; toolName: string; result: unknown; iteration: number }
  | { type: "message.complete"; message: AssistantModelMessage | ToolModelMessage }
  | { type: "agent.end"; reason: AgentLoopStopReason; error?: string };

export type AgentLoopStopReason = "finish" | "max_iterations" | "error";
