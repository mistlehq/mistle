import type { RouteHandler } from "@hono/zod-openapi";
import type { z } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationAccess } from "../../auth/services/organization-authorization.js";
import type { AppAuthContext, AppContextBindings } from "../../types.js";
import { route } from "./route.js";
import type { CurrentActorResponseSchema } from "./schema.js";

type CurrentActorResponse = z.output<typeof CurrentActorResponseSchema>;

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const authContext = ctx.get("authContext");
  if (authContext === null) {
    throw new Error("Expected authenticated request context to be available.");
  }

  return ctx.json(await buildCurrentActorResponse({ ctx, authContext }), 200);
};

async function buildCurrentActorResponse(input: {
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0];
  authContext: AppAuthContext;
}): Promise<CurrentActorResponse> {
  if (input.authContext.kind === "api_key") {
    return {
      authentication: {
        kind: "api_key",
        apiKey: {
          id: input.authContext.apiKey.id,
          name: input.authContext.apiKey.name,
        },
      },
      actor: {
        kind: "api_key",
        id: input.authContext.apiKey.id,
        name: input.authContext.apiKey.name,
      },
      organization: {
        id: input.authContext.apiKey.organizationId,
      },
      permissions: [...input.authContext.permissions],
    };
  }

  if (input.authContext.kind === "mcp_capability") {
    throw new Error("MCP capability auth is only supported by MCP routes.");
  }

  const authorization = await requireActiveOrganizationAccess({
    db: input.ctx.get("db"),
    actorUserId: input.authContext.session.user.id,
    activeOrganizationId: input.authContext.session.activeOrganizationId,
  });

  return {
    authentication: {
      kind: "session",
    },
    actor: {
      kind: "user",
      id: input.authContext.session.user.id,
    },
    organization: {
      id: input.authContext.session.activeOrganizationId,
    },
    permissions: [...authorization.permissions],
  };
}

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
