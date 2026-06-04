import { describe, expect, it } from "vitest";

import { composeIntegrationMiddleware, type IntegrationMiddleware } from "./index.js";

type TestContext = {
  readonly events: string[];
};

describe("integration middleware composition", () => {
  it("runs middleware in nested order around the terminal next callback", async () => {
    const middleware: readonly IntegrationMiddleware<TestContext>[] = [
      async (context, next) => {
        context.events.push("one:before");
        await next();
        context.events.push("one:after");
      },
      async (context, next) => {
        context.events.push("two:before");
        await next();
        context.events.push("two:after");
      },
    ];
    const context: TestContext = { events: [] };

    await composeIntegrationMiddleware(middleware)(context, async () => {
      context.events.push("terminal");
    });

    expect(context.events).toEqual([
      "one:before",
      "two:before",
      "terminal",
      "two:after",
      "one:after",
    ]);
  });

  it("stops the chain when middleware returns without calling next", async () => {
    const middleware: readonly IntegrationMiddleware<TestContext>[] = [
      async (context, next) => {
        context.events.push("one:before");
        await next();
        context.events.push("one:after");
      },
      (context) => {
        context.events.push("two");
      },
      (context) => {
        context.events.push("three");
      },
    ];
    const context: TestContext = { events: [] };

    await composeIntegrationMiddleware(middleware)(context, async () => {
      context.events.push("terminal");
    });

    expect(context.events).toEqual(["one:before", "two", "one:after"]);
  });

  it("runs the terminal next callback when the middleware list is empty", async () => {
    const context: TestContext = { events: [] };

    await composeIntegrationMiddleware<TestContext>([])(context, async () => {
      context.events.push("terminal");
    });

    expect(context.events).toEqual(["terminal"]);
  });

  it("rejects when middleware calls next more than once", async () => {
    const middleware: readonly IntegrationMiddleware<TestContext>[] = [
      async (context, next) => {
        context.events.push("before");
        await next();
        await next();
      },
    ];
    const context: TestContext = { events: [] };

    await expect(
      composeIntegrationMiddleware(middleware)(context, async () => {
        context.events.push("terminal");
      }),
    ).rejects.toThrow("Integration middleware next() called multiple times.");
    expect(context.events).toEqual(["before", "terminal"]);
  });

  it("rejects when synchronous middleware calls next more than once without awaiting", async () => {
    const middleware: readonly IntegrationMiddleware<TestContext>[] = [
      (context, next) => {
        context.events.push("before");
        void next();
        void next();
      },
    ];
    const context: TestContext = { events: [] };

    await expect(
      composeIntegrationMiddleware(middleware)(context, async () => {
        context.events.push("terminal");
      }),
    ).rejects.toThrow("Integration middleware next() called multiple times.");
    expect(context.events).toEqual(["before", "terminal"]);
  });
});
