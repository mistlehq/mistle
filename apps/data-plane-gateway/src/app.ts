import { Hono } from "hono";

import type { GatewayForwardingReadiness } from "./runtime/gateway-forwarding-readiness.js";
import type { GatewayLifecycle } from "./runtime/gateway-lifecycle.js";
import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";
import type { AppContextBindings, DataPlaneGatewayApp, DataPlaneGatewayConfig } from "./types.js";

export function createApp(
  config: DataPlaneGatewayConfig,
  lifecycle: GatewayLifecycle,
  forwardingReadiness: GatewayForwardingReadiness,
): DataPlaneGatewayApp {
  const app = new Hono<AppContextBindings>();
  const resources = createAppResources(config);

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  app.get("/__readyz", (c) => {
    const state = lifecycle.getState();
    const forwarding = forwardingReadiness.getSnapshot();
    if (state.status === "serving" && forwarding.status === "ready") {
      return c.json({
        ok: true,
        status: state.status,
        forwarding,
      });
    }

    return c.json(
      {
        ok: false,
        status: state.status,
        forwarding,
        ...(state.status === "draining"
          ? {
              reason: state.reason,
              startedAtMs: state.startedAtMs,
            }
          : {
              reason: forwarding.reason,
            }),
      },
      503,
    );
  });

  app.use("*", async (ctx, next) => {
    const testEnvironmentIdResult = readTestEnvironmentId(config, {
      readHeader: (name) => ctx.req.header(name),
      readQuery: (name) => ctx.req.query(name),
    });
    if (testEnvironmentIdResult.kind === "missing") {
      return ctx.json({ error: testEnvironmentIdResult.message }, 400);
    }

    const testEnvironmentId = testEnvironmentIdResult.testEnvironmentId;
    ctx.set("config", config);
    if (testEnvironmentId !== undefined) {
      ctx.set("testEnvironmentId", testEnvironmentId);
    }
    const resourceRequest =
      testEnvironmentId === undefined
        ? undefined
        : {
            testEnvironmentId,
          };
    ctx.set("db", resources.getDb(resourceRequest));
    ctx.set("tables", resources.getTables(resourceRequest));
    await next();
  });

  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: DataPlaneGatewayApp): Promise<void> {
  await stopAppResources(app);
}

function readTestEnvironmentId(
  config: DataPlaneGatewayConfig,
  input: {
    readHeader: (name: string) => string | undefined;
    readQuery: (name: string) => string | undefined;
  },
):
  | { kind: "present"; testEnvironmentId: string | undefined }
  | { kind: "missing"; message: string } {
  const testIsolation = config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return { kind: "present", testEnvironmentId: undefined };
  }

  const testEnvironmentId =
    input.readHeader(testIsolation.testEnvironmentIdHeader) ??
    input.readQuery(testIsolation.testEnvironmentIdHeader);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    return {
      kind: "missing",
      message: `Expected '${testIsolation.testEnvironmentIdHeader}' header or query parameter for isolated data-plane gateway request.`,
    };
  }

  return { kind: "present", testEnvironmentId };
}
