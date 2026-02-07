import { Hono } from "hono";

export const app = new Hono();

app.get("/api", (c) => {
  return c.json({ ok: true, message: "API is running" });
});
