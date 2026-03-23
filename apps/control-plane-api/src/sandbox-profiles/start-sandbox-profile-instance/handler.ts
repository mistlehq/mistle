import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startProfileInstance } from "../services/start-profile-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user, session }: AppSession,
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
    },
    {
      organizationId: session.activeOrganizationId,
      profileId,
      profileVersion: version,
      startedBy: {
        kind: "user",
        id: user.id,
      },
      source: "dashboard",
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      image: {
        imageId: sandboxConfig.defaultBaseImage,
        createdAt: new Date().toISOString(),
      },
    },
  );

  return ctx.json(startedSandboxInstance, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
