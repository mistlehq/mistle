import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { getDesignerRuntimeConversationTranscript } from "../services/designer-sessions.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const params = ctx.req.valid("param");
  const designerActor = requireDesignerOrganizationActor(organizationActor);
  const config = ctx.get("config");
  const transcript = await getDesignerRuntimeConversationTranscript(
    {
      db: ctx.get("db"),
      cache: ctx.get("cache"),
      dataPlaneClient: ctx.get("dataPlaneClient"),
      connectionTokenConfig: ctx.get("connectionTokenConfig"),
      gatewayWebsocketUrl: ctx.get("sandboxConfig").gatewayWsUrl,
      integrationsConfig: {
        masterEncryptionKeys: config.integrations.masterEncryptionKeys,
      },
    },
    {
      organizationId: organizationActor.organizationId,
      sessionId: params.sessionId,
      actingUserId: designerActor.userId,
    },
  );

  return ctx.json(transcript, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_READ,
  }),
);
