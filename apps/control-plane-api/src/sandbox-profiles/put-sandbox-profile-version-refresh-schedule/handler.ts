import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { putProfileVersionRefreshSchedule } from "../services/put-profile-version-refresh-schedule.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const refreshSchedule = await putProfileVersionRefreshSchedule(
    {
      db,
    },
    {
      organizationId: organizationActor.organizationId,
      profileId,
      profileVersion: version,
      ...body,
      now: systemClock.nowDate(),
    },
  );

  return ctx.json(refreshSchedule, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  }),
);
