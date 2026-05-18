import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { publishProfileVersion } from "../services/publish-profile-version.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const integrationRegistry = ctx.get("integrationRegistry");
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");

  const response = await publishProfileVersion(
    {
      db,
      dataPlaneClient,
      integrationRegistry,
      sandboxConfig,
      defaultBaseImage: sandboxConfig.defaultBaseImage,
    },
    {
      organizationId: organizationActor.organizationId,
      profileId,
      profileVersion: version,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  }),
);
