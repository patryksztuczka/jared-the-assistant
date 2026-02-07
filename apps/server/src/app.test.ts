import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { EventPublisher } from "./events/types";

const createPublisherSpy = () => {
  const publisher: EventPublisher = {
    publish: async () => {
      return;
    },
  };

  return { publisher };
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
