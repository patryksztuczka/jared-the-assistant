import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("GET /api", () => {
  test("returns success response", async () => {
    const res = await app.request("/api");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, message: "API is running" });
  });
});
