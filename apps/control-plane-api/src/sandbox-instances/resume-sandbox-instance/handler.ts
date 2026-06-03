import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { resumeInstance } from "../services/resume-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const cache = ctx.get("cache");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { integrations: integrationsConfig } = ctx.get("config");
  const { instanceId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const sandboxInstance = await resumeInstance(
    {
      db,
      cache,
      integrationsConfig,
      dataPlaneClient,
    },
    {
      organizationId: organizationActor.organizationId,
      instanceId,
      ...(organizationActor.kind === "user"
        ? {
            actingUser: {
              userId: organizationActor.userId,
            },
          }
        : {}),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    },
  );

  return ctx.json(sandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_SESSION_RESUME,
  }),
);
