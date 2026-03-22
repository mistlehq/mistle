import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  handleHttpError,
  NotFoundResponseSchema,
  NotFoundError,
  withHttpErrorHandler,
} from "./errors.js";

describe("errors", () => {
  it("creates a strict code/message schema", () => {
    const parsed = NotFoundResponseSchema.parse({
      code: "NOT_FOUND",
      message: "Missing resource.",
    });

    expect(parsed).toEqual({
      code: "NOT_FOUND",
      message: "Missing resource.",
    });
    expect(() =>
      NotFoundResponseSchema.parse({
        code: "NOT_FOUND",
        message: "Missing resource.",
        extra: "nope",
      }),
    ).toThrow();
  });

  it("translates HttpError instances into JSON responses", async () => {
    const app = new Hono();
    app.get(
      "/resource",
      withHttpErrorHandler(async () => {
        throw new NotFoundError("NOT_FOUND", "Missing resource.");
      }),
    );

    const response = await app.request("/resource");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Missing resource.",
    });
  });

  it("rethrows unknown errors for outer handlers", async () => {
    const app = new Hono();
    app.onError((error, ctx) => ctx.text(error.message, 500));
    app.get(
      "/boom",
      withHttpErrorHandler(async () => {
        throw new Error("boom");
      }),
    );

    const response = await app.request("/boom");

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("boom");
  });

  it("handles HttpError directly", async () => {
    const app = new Hono();
    app.get("/direct", (ctx) =>
      handleHttpError(ctx, new NotFoundError("NOT_FOUND", "Missing resource.")),
    );

    const response = await app.request("/direct");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Missing resource.",
    });
  });
});
