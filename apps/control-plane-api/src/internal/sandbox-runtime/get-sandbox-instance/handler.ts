import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { logger } from "../../../logger.js";
import type { AppContextBindings } from "../../../types.js";
import { getSandboxInstance } from "../services/get-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const body = ctx.req.valid("json");

  let sandboxInstance: Awaited<ReturnType<typeof getSandboxInstance>>;
  try {
    sandboxInstance = await getSandboxInstance(
      {
        dataPlaneClient,
      },
      body,
    );
  } catch (error) {
    logger.error(
      {
        eventName: "internal_sandbox_runtime.status_lookup_failed",
        "mistle.organization.id": body.organizationId,
        "mistle.sandbox.instance_id": body.instanceId,
        err: error,
      },
      "Failed to resolve internal sandbox runtime status.",
    );
    throw error;
  }

  return ctx.json(sandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
