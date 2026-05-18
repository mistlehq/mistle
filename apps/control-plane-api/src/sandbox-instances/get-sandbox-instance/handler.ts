import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { logger } from "../../logger.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { getInstance } from "../services/get-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { instanceId } = ctx.req.valid("param");

  let sandboxInstance: Awaited<ReturnType<typeof getInstance>>;
  try {
    sandboxInstance = await getInstance(
      {
        db,
        dataPlaneClient,
      },
      {
        organizationId: organizationActor.organizationId,
        instanceId,
      },
    );
  } catch (error) {
    logger.error(
      {
        eventName: "sandbox_instance.status_lookup_failed",
        "mistle.organization.id": organizationActor.organizationId,
        "mistle.sandbox.instance_id": instanceId,
        err: error,
      },
      "Failed to resolve sandbox instance status.",
    );
    throw error;
  }

  return ctx.json(sandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_SESSION_READ,
  }),
);
