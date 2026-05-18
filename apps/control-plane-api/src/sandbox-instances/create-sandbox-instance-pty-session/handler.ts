import type { RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { SANDBOX_INSTANCE_PTY_TRANSPORT_TOKEN_TTL_SECONDS } from "../constants.js";
import { mintPtySession } from "../services/mint-pty-session.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  if (organizationActor.kind !== "user") {
    throw new ForbiddenError("FORBIDDEN", "PTY transport tokens require an authenticated user.");
  }

  const dataPlaneClient = ctx.get("dataPlaneClient");
  const sandboxConfig = ctx.get("sandboxConfig");
  const ptyTransportConfig = ctx.get("ptyTransportConfig");
  const { instanceId } = ctx.req.valid("param");
  const { ptySessionId } = ctx.req.valid("json");

  const ptySession = await mintPtySession(
    {
      dataPlaneClient,
    },
    {
      organizationId: organizationActor.organizationId,
      instanceId,
      ptySessionId,
      actingUserId: organizationActor.userId,
      gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
      tokenTtlSeconds: SANDBOX_INSTANCE_PTY_TRANSPORT_TOKEN_TTL_SECONDS,
      tokenConfig: ptyTransportConfig,
    },
  );

  return ctx.json(ptySession, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_SESSION_CONNECT,
  }),
);
