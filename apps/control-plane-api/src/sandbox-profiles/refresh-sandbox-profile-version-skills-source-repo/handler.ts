import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import {
  createSkillsSourceRepoConnectionTokenConfig,
  refreshProfileVersionSkillsSourceRepo,
} from "../services/skills-source-repos.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const sandboxConfig = ctx.get("sandboxConfig");
  const connectionTokenConfig = ctx.get("connectionTokenConfig");
  const { integrations: integrationsConfig, mcp: mcpConfig } = ctx.get("config");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const result = await refreshProfileVersionSkillsSourceRepo(
    {
      db,
      dataPlaneClient,
      integrationsConfig,
      mcpConfig,
      defaultBaseImage: sandboxConfig.defaultBaseImage,
      gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
      connectionTokenConfig: createSkillsSourceRepoConnectionTokenConfig(connectionTokenConfig),
    },
    {
      organizationId: organizationActor.organizationId,
      profileId,
      profileVersion: version,
      originUrl: body.originUrl,
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
      startedBy: resolveStartedBy(organizationActor),
    },
  );

  return ctx.json(result, 200);
};

function resolveStartedBy(organizationActor: AppOrganizationActor): {
  kind: "api_key" | "system" | "user";
  id: string;
} {
  if (organizationActor.kind === "api_key") {
    return {
      kind: "api_key",
      id: organizationActor.apiKeyId,
    };
  }

  if (organizationActor.kind === "mcp_capability") {
    return {
      kind: "system",
      id: organizationActor.capability.sandboxInstanceId,
    };
  }

  return {
    kind: "user",
    id: organizationActor.userId,
  };
}

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
  }),
);
