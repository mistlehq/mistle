import type { RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { prepareDesignerRuntimeProviderMcpInstallForSession } from "../services/designer-runtime-provider-mcp.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");
  requireDesignerOrganizationActor(organizationActor);
  if (
    !organizationActor.permissions.includes(OrganizationPermissions.INTEGRATION_CONNECTION_READ)
  ) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const preparedInstall = await prepareDesignerRuntimeProviderMcpInstallForSession(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
    },
    {
      organizationId: organizationActor.organizationId,
      designerSessionId: params.sessionId,
      connectionId: body.connectionId,
      toolIds: body.toolIds,
    },
  );

  return ctx.json(
    {
      status: preparedInstall.status,
      runtimeAction: {
        type: preparedInstall.runtimeAction.type,
        runtimeClientId: preparedInstall.runtimeAction.runtimeClientId,
        mcpServers: preparedInstall.runtimeAction.mcpServers.map((server) => ({
          serverName: server.serverName,
          transport: server.transport,
          url: server.url,
          httpHeaders: server.httpHeaders,
        })),
        egressRouteMatchers: preparedInstall.runtimeAction.egressRouteMatchers.map((route) => ({
          egressRuleId: route.egressRuleId,
          hosts: [...route.hosts],
          pathPrefixes: [...route.pathPrefixes],
          ...(route.methods === undefined ? {} : { methods: [...route.methods] }),
          designerRuntimeMcp: {
            integrationConnectionId: route.designerRuntimeMcp.integrationConnectionId,
            providerToolIds: [...route.designerRuntimeMcp.providerToolIds],
          },
        })),
      },
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
  }),
);
