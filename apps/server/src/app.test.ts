import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { EVENT_TYPE, type AgentEvent, type EventPublisher } from "./events/types";

const createPublisherSpy = () => {
  const publishedEvents: AgentEvent[] = [];
  const publisher: EventPublisher = {
    publish: async (event) => {
      publishedEvents.push(event);
    },
  };

  return {
    publisher,
    publishedEvents,
  };
};

describe("GET /api", () => {
  test("returns success response", async () => {
    const { publisher } = createPublisherSpy();
    const app = createApp({ publisher });

    const res = await app.request("/api");
    const body = (await res.json()) as { ok: boolean; message: string };

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "API is running" });
  });
});

describe("POST /api/agent", () => {
  test("uses crypto ids when correlationId is not provided", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const app = createApp({ publisher });

    const res = await app.request("/api/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Use default id generation",
      }),
    });

    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      eventId: string;
      correlationId: string;
    };

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("accepted");
    expect(typeof body.eventId).toBe("string");
    expect(body.eventId.length).toBeGreaterThan(0);
    expect(typeof body.correlationId).toBe("string");
    expect(body.correlationId.length).toBeGreaterThan(0);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_REQUESTED);
    expect(publishedEvents[0]?.id).toBe(body.eventId);
    expect(publishedEvents[0]?.correlationId).toBe(body.correlationId);
  });

  test("accepts valid event request and publishes agent.run.requested", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const app = createApp({ publisher });

    const res = await app.request("/api/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Summarize this run",
      }),
    });

    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      eventId: string;
      correlationId: string;
    };

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("accepted");
    expect(typeof body.eventId).toBe("string");
    expect(body.eventId.length).toBeGreaterThan(0);
    expect(typeof body.correlationId).toBe("string");
    expect(body.correlationId.length).toBeGreaterThan(0);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]?.id).toBe(body.eventId);
    expect(publishedEvents[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_REQUESTED);
    expect(typeof publishedEvents[0]?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(publishedEvents[0]?.timestamp ?? ""))).toBe(false);
    expect(publishedEvents[0]?.correlationId).toBe(body.correlationId);
    expect(publishedEvents[0]?.payload).toEqual({
      prompt: "Summarize this run",
      simulateFailure: undefined,
    });
  });

  test("rejects invalid payload and does not publish", async () => {
    const { publisher, publishedEvents } = createPublisherSpy();
    const app = createApp({ publisher });

    const res = await app.request("/api/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        wrong: "payload",
      }),
    });

    const body = (await res.json()) as { ok: boolean; error: string };

    expect(res.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: "Invalid request body. Expected { prompt: string, correlationId?: string }",
    });
    expect(publishedEvents).toHaveLength(0);
  });
});
