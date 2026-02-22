import { Command } from "commander";
import inquirer from "inquirer";

type RunStatus = "queued" | "processing" | "completed" | "failed";

interface ChatMessageAcceptedResponse {
  ok: true;
  status: "accepted";
  runId: string;
  threadId: string;
  correlationId: string;
}

interface RunLoopEventRecord {
  id: string;
  eventType: string;
  payload: unknown;
}

interface CliConfig {
  baseUrl: string;
  model?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  threadId?: string;
}

interface CommandOptions {
  baseUrl: string;
  model?: string;
  timeoutMs: string;
  pollMs: string;
  threadId?: string;
}

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

const config = parseArgs(process.argv);

const run = async () => {
  let activeThreadId = config.threadId;

  console.log("Agent chat smoke CLI");
  console.log(`Server: ${config.baseUrl}`);
  console.log(`Model: ${config.model ?? "(server default)"}`);
  console.log("Type a message and press Enter. Type /exit to quit.");

  while (true) {
    const promptPrefix = activeThreadId ? `[${activeThreadId}]` : "[new thread]";
    const promptAnswer = await inquirer.prompt<{ message: string }>([
      {
        type: "input",
        name: "message",
        message: `${promptPrefix} You:`,
      },
    ]);
    const message = promptAnswer.message.trim();

    if (!message) {
      continue;
    }

    if (message === "/exit" || message === "/quit") {
      break;
    }

    const accepted = await sendMessage({
      baseUrl: config.baseUrl,
      content: message,
      model: config.model,
      threadId: activeThreadId,
    });

    activeThreadId = accepted.threadId;

    console.log(`Run accepted: ${accepted.runId}`);
    const streamStatus = await waitForRunStream({
      baseUrl: config.baseUrl,
      runId: accepted.runId,
    });

    if (streamStatus.status === "failed") {
      console.log(`Assistant run failed: ${streamStatus.safeError ?? "Unknown error"}`);
      continue;
    }

    if (!streamStatus.reply) {
      console.log("Assistant: (no reply message found yet)");
      continue;
    }

    console.log(`Assistant: ${streamStatus.reply}`);
  }
};

function parseArgs(argv: string[]): CliConfig {
  const program = new Command();

  program
    .name("chat-smoke")
    .description("Interactive CLI to test sending and receiving agent messages")
    .option("-u, --base-url <url>", "API base URL", DEFAULT_BASE_URL)
    .option("-m, --model <model>", "Model id used for /api/chat/messages")
    .option("--thread-id <id>", "Continue an existing thread")
    .option("--timeout-ms <number>", "Max wait for run completion", `${DEFAULT_TIMEOUT_MS}`)
    .option("--poll-ms <number>", "Poll interval for run status", `${DEFAULT_POLL_INTERVAL_MS}`)
    .parse(argv);

  const options = program.opts<CommandOptions>();

  return {
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    model: options.model,
    timeoutMs: toPositiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    pollIntervalMs: toPositiveNumber(options.pollMs, DEFAULT_POLL_INTERVAL_MS),
    threadId: options.threadId,
  };
}

function toPositiveNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const sendMessage = async (inputData: {
  baseUrl: string;
  content: string;
  model?: string;
  threadId?: string;
}) => {
  const response = await fetch(`${inputData.baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: inputData.content,
      model: inputData.model,
      threadId: inputData.threadId,
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`Failed to send message (${response.status}): ${errorPayload}`);
  }

  const payload = (await response.json()) as Partial<ChatMessageAcceptedResponse>;
  if (!payload.runId || !payload.threadId || !payload.correlationId) {
    throw new Error("Invalid /api/chat/messages response shape");
  }

  return payload as ChatMessageAcceptedResponse;
};

const waitForRunStream = async (inputData: { baseUrl: string; runId: string }) => {
  const response = await fetch(`${inputData.baseUrl}/api/chat/runs/${inputData.runId}/stream`);
  if (!response.ok) {
    throw new Error(`Failed to stream run status (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body available to read stream");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalStatus: RunStatus = "processing";
  let safeError: string | undefined;
  let reply: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      const lines = chunk.split("\n");
      let eventType = "message";
      let eventData = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        }
      }

      if (!eventData) {
        continue;
      }

      try {
        const payload = JSON.parse(eventData);

        switch (eventType) {
          case "run.event": {
            const mapped = mapEventForDisplay(payload as RunLoopEventRecord);
            if (mapped) {
              console.log(mapped);
            }
            break;
          }
          case "run.status": {
            finalStatus = payload.status;
            safeError = payload.safeError;
            break;
          }
          case "run.reply": {
            reply = payload.content;
            break;
          }
        }
      } catch (error) {
        console.error("Failed to parse SSE event data:", error);
      }
    }
  }

  return { status: finalStatus, safeError, reply };
};

const mapEventForDisplay = (event: RunLoopEventRecord) => {
  if (event.eventType === "loop.started") {
    const prompt = getStringFromPayload(event.payload, ["prompt"]);
    if (!prompt) {
      return "Agent started processing";
    }
    return `Agent started: "${prompt}"`;
  }

  if (event.eventType === "loop.completed") {
    const output = getStringFromPayload(event.payload, ["output"]);
    if (!output) {
      return "Agent completed";
    }
    return `Agent completed: "${output.slice(0, 100)}${output.length > 100 ? "..." : ""}"`;
  }

  if (event.eventType === "loop.error") {
    const error = getStringFromPayload(event.payload, ["error"]);
    if (!error) {
      return "Agent error";
    }
    return `Agent error: ${error}`;
  }
};

const getStringFromPayload = (payload: unknown, path: string[]) => {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const payloadRecord = payload as Record<string, unknown>;

  if (path.length === 1 && path[0]) {
    const value = payloadRecord[path[0]];
    if (typeof value !== "string") {
      return;
    }
    return value;
  }

  const p0 = path[0];
  const p1 = path[1];

  if (!p0 || !p1) {
    return;
  }

  const first = payloadRecord[p0];
  if (!first || typeof first !== "object") {
    return;
  }

  const firstRecord = first as Record<string, unknown>;
  const value = firstRecord[p1];
  if (typeof value !== "string") {
    return;
  }

  return value;
};

await run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`chat-smoke failed: ${message}`);
  process.exitCode = 1;
});
