import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { compileProfileVersionRuntimePlan } from "../../../sandbox-profiles/compile-profile-version-runtime-plan.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("db");
  const integrationsConfig = ctx.get("config").integrations;
  const body = ctx.req.valid("json");

  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: body.organizationId,
      profileId: body.profileId,
      profileVersion: body.profileVersion,
      image: {
        source: body.image.kind,
        imageRef: body.image.imageId,
      },
    },
  );

  return ctx.json(
    {
      runtimePlan,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
