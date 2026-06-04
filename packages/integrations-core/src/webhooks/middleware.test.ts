import { describe, expect, it } from "vitest";

import type { IntegrationWebhookMiddlewareBaseContext } from "../types/index.js";
import {
  createIntegrationWebhookRequestSnapshot,
  runIntegrationWebhookMiddleware,
} from "./middleware.js";

const BaseContext: IntegrationWebhookMiddlewareBaseContext = {
  request: createIntegrationWebhookRequestSnapshot({
    targetKey: "slack",
    endpointKey: "source_123",
    headers: {
      "content-type": "application/json",
    },
    rawBody: new TextEncoder().encode('{"hello":"world"}'),
  }),
  organizationId: "org_123",
  target: {
    targetKey: "slack",
    familyId: "slack",
    variantId: "slack-default",
    enabled: true,
    config: {},
    secrets: {},
  },
  connection: {
    id: "icn_123",
    status: "active",
    config: {},
    secrets: {},
  },
  webhookSource: {
    id: "iws_123",
    endpointKey: "source_123",
    providerMetadata: {},
    secrets: {},
  },
};

describe("integration webhook middleware", () => {
  it("provides memoized request text and JSON helpers over the captured raw body", () => {
    const request = createIntegrationWebhookRequestSnapshot({
      targetKey: "github",
      endpointKey: "source_123",
      headers: {},
      rawBody: new TextEncoder().encode('{"ok":true}'),
    });

    expect(request.text()).toBe('{"ok":true}');
    expect(request.text()).toBe('{"ok":true}');
    expect(request.json()).toEqual({ ok: true });
    expect(request.json()).toEqual({ ok: true });
  });

  it("short-circuits when middleware responds without calling next", async () => {
    const result = await runIntegrationWebhookMiddleware({
      context: BaseContext,
      middleware: [
        (context) => {
          context.respond({
            status: 200,
            body: {
              challenge: "abc",
            },
          });
        },
      ],
      next: async () => "core",
    });

    expect(result).toEqual({
      kind: "short-circuited",
      response: {
        status: 200,
        body: {
          challenge: "abc",
        },
      },
    });
  });

  it("continues into the terminal handler when middleware calls next", async () => {
    const result = await runIntegrationWebhookMiddleware({
      context: BaseContext,
      middleware: [
        async (_context, next) => {
          await next();
        },
      ],
      next: async () => "core",
    });

    expect(result).toEqual({
      kind: "continued",
      result: "core",
    });
  });

  it("shares request-local state across middleware without leaking across runs", async () => {
    const firstResult = await runIntegrationWebhookMiddleware({
      context: BaseContext,
      middleware: [
        async (context, next) => {
          context.state.set("test.value", "parsed");
          await next();
        },
        async (context, next) => {
          if (context.state.get("test.value") !== "parsed") {
            throw new Error("Expected middleware state to be visible to later middleware.");
          }

          await next();
        },
      ],
      next: async (context) => context.state.get("test.value"),
    });

    const secondResult = await runIntegrationWebhookMiddleware({
      context: BaseContext,
      middleware: [
        async (context, next) => {
          await next();
          context.state.set("test.value", "mutated after terminal handler");
        },
      ],
      next: async (context) => context.state.has("test.value"),
    });

    expect(firstResult).toEqual({
      kind: "continued",
      result: "parsed",
    });
    expect(secondResult).toEqual({
      kind: "continued",
      result: false,
    });
  });

  it("rejects middleware that short-circuits without responding", async () => {
    await expect(
      runIntegrationWebhookMiddleware({
        context: BaseContext,
        middleware: [() => {}],
        next: async () => "core",
      }),
    ).rejects.toThrow("Integration webhook middleware short-circuited without setting a response.");
  });

  it("rejects middleware that responds more than once", async () => {
    await expect(
      runIntegrationWebhookMiddleware({
        context: BaseContext,
        middleware: [
          (context) => {
            context.respond({ status: 200 });
            context.respond({ status: 202 });
          },
        ],
        next: async () => "core",
      }),
    ).rejects.toThrow("Integration webhook middleware response has already been set.");
  });

  it("rejects middleware that continues after responding", async () => {
    await expect(
      runIntegrationWebhookMiddleware({
        context: BaseContext,
        middleware: [
          async (context, next) => {
            context.respond({ status: 200 });
            await next();
          },
        ],
        next: async () => "core",
      }),
    ).rejects.toThrow("Integration webhook middleware cannot continue after responding.");
  });

  it("rejects middleware that responds after continuing", async () => {
    await expect(
      runIntegrationWebhookMiddleware({
        context: BaseContext,
        middleware: [
          async (context, next) => {
            await next();
            context.respond({ status: 200 });
          },
        ],
        next: async () => "core",
      }),
    ).rejects.toThrow("Integration webhook middleware cannot respond after continuing.");
  });
});
