import Redis from "ioredis";
import { createApp } from "./app";
import { createDrizzleChatIngressStore } from "./chat/ingress-store";
import { createDrizzleChatMessageStore } from "./chat/message-store";
import { createDrizzleChatRunStore } from "./chat/run-store";
import { OutboxPublisher } from "./events/outbox-publisher";
import { createDrizzleOutboxStore } from "./events/outbox-store";
import { RedisStreamBus } from "./events/redis-stream";
import { AgentRuntime } from "./runtime/agent-runtime";
import { db } from "../db";

const port = Number(process.env.PORT ?? 3000);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisStreamKey = process.env.REDIS_STREAM_KEY ?? "agent_events";
const redisConsumerGroup = process.env.REDIS_CONSUMER_GROUP ?? "agent_runtime";
const redisConsumerName = process.env.REDIS_CONSUMER_NAME ?? `worker-${process.pid}`;

const redis = new Redis(redisUrl);
const bus = new RedisStreamBus(redis, {
  streamKey: redisStreamKey,
});
const messageStore = createDrizzleChatMessageStore(db);
const runStore = createDrizzleChatRunStore(db);
const ingressStore = createDrizzleChatIngressStore(db);
const outboxStore = createDrizzleOutboxStore(db);
const outboxPublisher = new OutboxPublisher({
  outboxStore,
  publisher: bus,
});
const runtime = new AgentRuntime({
  bus,
  messageStore,
  runStore,
  consumerGroup: redisConsumerGroup,
  consumerName: redisConsumerName,
});

await runtime.init();
runtime.start();
outboxPublisher.start();

const app = createApp({ ingressStore, messageStore, runStore });

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Server listening on http://localhost:${port}`);

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  runtime.stop();
  outboxPublisher.stop();

  try {
    server.stop(true);
  } catch {
    // no-op
  }

  try {
    await redis.quit();
  } catch {
    // no-op
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
