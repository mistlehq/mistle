import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { patchInstanceTitle } from "../services/patch-instance-title.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { instanceId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const sandboxInstance = await patchInstanceTitle(
    {
      dataPlaneClient,
    },
    {
      organizationId: session.activeOrganizationId,
      instanceId,
      title: body.title,
    },
  );

  return ctx.json(sandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
