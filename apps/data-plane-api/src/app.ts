import { DATA_PLANE_TRPC_PATH } from "@mistle/data-plane-trpc/constants";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";

import type { AppContextBindings, DataPlaneApiRuntimeConfig, DataPlaneApp } from "./types.js";

import { createAppResources, setAppResources, stopAppResources } from "./runtime/resources.js";
import { createDataPlaneTrpcContext, dataPlaneTrpcRouter } from "./trpc/index.js";

export async function createApp(runtimeConfig: DataPlaneApiRuntimeConfig): Promise<DataPlaneApp> {
  const app = new Hono<AppContextBindings>();
  const resources = await createAppResources(runtimeConfig.app);
  app.use("*", async (ctx, next) => {
    ctx.set("config", runtimeConfig.app);
    ctx.set("internalAuthServiceToken", runtimeConfig.internalAuthServiceToken);
    await next();
  });
  const trpcContext = createDataPlaneTrpcContext({
    config: runtimeConfig.app,
    internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
    resources,
  });

  app.all(`${DATA_PLANE_TRPC_PATH}/*`, (c) => {
    return fetchRequestHandler({
      createContext: () => trpcContext,
      endpoint: DATA_PLANE_TRPC_PATH,
      req: c.req.raw,
      router: dataPlaneTrpcRouter,
    });
  });

  app.get("/__healthz", (c) => {
    return c.json({ ok: true });
  });

  setAppResources(app, resources);

  return app;
}

export async function stopApp(app: DataPlaneApp): Promise<void> {
  await stopAppResources(app);
}
