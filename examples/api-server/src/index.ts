import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { Agent, webfetch } from "@jarred/agent-core";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

export const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

const app = new Hono();
const agentsByIp = new Map<string, Agent>();

const systemPrompt = `
You are a helpful assistant.

Action selection policy:
  - You must set action to exactly one of: continue, finish.
  - Use continue only when another internal iteration is needed to complete the task.
  - Use finish when your response is complete and ready for the user.
  - If you need clarification from the user, set action to finish and include the clarification question(s) in response.
  - If information is missing or ambiguous, set action to finish and ask concise, specific follow-up question(s) in response.
`;

function getClientIp(headers: Headers) {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown";
}

function getAgentForIp(ip: string) {
  let agent = agentsByIp.get(ip);

  if (!agent) {
    agent = new Agent({
      initialState: {
        tools: { webfetch },
        systemPrompt,
      },
      telemetry: true,
    });
    agentsByIp.set(ip, agent);
  }

  return agent;
}

app.use("/*", cors());

app.post("/message", async (c) => {
  const { message } = await c.req.json<{ message: string }>();
  const clientIp = getClientIp(c.req.raw.headers);

  return streamSSE(c, async (stream) => {
    const agent = getAgentForIp(clientIp);

    let id = 0;

    const done = new Promise<void>((resolve) => {
      const unsubscribe = agent.subscribe((event) => {
        const streamedTypes = ["agent.start", "agent.end", "agent.token", "message.complete"];

        if (!streamedTypes.includes(event.type)) return;

        stream
          .writeSSE({
            id: String(id++),
            event: event.type,
            data: JSON.stringify(event),
          })
          .catch(console.error);

        if (event.type === "agent.end") {
          unsubscribe();
          resolve();
        }
      });
    });

    void agent.prompt(message);

    await done;
  });
});

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
