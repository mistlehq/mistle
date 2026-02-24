import { Hono } from "hono";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
