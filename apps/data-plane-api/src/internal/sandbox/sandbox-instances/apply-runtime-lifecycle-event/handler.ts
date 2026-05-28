import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { applySandboxRuntimeLifecycleEvent } from "../../../sandbox-instances/services/apply-sandbox-runtime-lifecycle-event.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response =
    body.kind === "runtime_readiness_reported"
      ? await applySandboxRuntimeLifecycleEvent(
          {
            db: resources.db,
            tables: resources.tables,
          },
          {
            sandboxInstanceId: params.id,
            kind: body.kind,
            ownerLeaseId: body.ownerLeaseId,
            runtimeReady: body.runtimeReady,
          },
        )
      : await applySandboxRuntimeLifecycleEvent(
          {
            db: resources.db,
            tables: resources.tables,
          },
          {
            sandboxInstanceId: params.id,
            kind: body.kind,
            ownerLeaseId: body.ownerLeaseId,
          },
        );

  return ctx.json(response, 200);
};
