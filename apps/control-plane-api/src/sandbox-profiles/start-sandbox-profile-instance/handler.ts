import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { startProfileInstance } from "../services/start-profile-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const integrationsConfig = ctx.get("config").integrations;
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const startedSandboxInstance = await startProfileInstance(
    {
      db,
      integrationsConfig,
      dataPlaneClient,
      defaultBaseImage: sandboxConfig.defaultBaseImage,
    },
    {
      organizationId: organizationActor.organizationId,
      profileId,
      profileVersion: version,
      startedBy: {
        kind: organizationActor.kind === "user" ? "user" : "api_key",
        id:
          organizationActor.kind === "user" ? organizationActor.userId : organizationActor.apiKeyId,
      },
      ...(organizationActor.kind === "user"
        ? {
            actingUser: {
              userId: organizationActor.userId,
            },
          }
        : {}),
      source: "dashboard",
      ...(body.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: body.primaryRepositoryId }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    },
  );

  return ctx.json(startedSandboxInstance, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_SESSION_CREATE,
  }),
);
