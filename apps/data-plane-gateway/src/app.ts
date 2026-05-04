import { Hono } from "hono";

import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";
import type { AppContextBindings, DataPlaneGatewayApp, DataPlaneGatewayConfig } from "./types.js";

export function createApp(config: DataPlaneGatewayConfig): DataPlaneGatewayApp {
  const app = new Hono<AppContextBindings>();
  const resources = createAppResources(config);

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  app.use("*", async (ctx, next) => {
    const testEnvironmentId = readTestEnvironmentId(config, (name) => ctx.req.header(name));
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
  readHeader: (name: string) => string | undefined,
): string | undefined {
  const testIsolation = config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return undefined;
  }

  const testEnvironmentId = readHeader(testIsolation.testEnvironmentIdHeader);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    throw new Error(
      `Expected '${testIsolation.testEnvironmentIdHeader}' header for isolated data-plane gateway request.`,
    );
  }

  return testEnvironmentId;
}
