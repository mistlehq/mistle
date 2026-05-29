import { Hono } from "hono";

import type { AppContextBindings, AppRoutes } from "../../types.js";
import { createOAuthAuthorizationServerMetadata } from "./authorization-server.js";
import {
  createMcpProtectedResourceMetadata,
  isConfiguredMcpProtectedResourceMetadataRequest,
  requireCanonicalMcpResourceUrl,
} from "./protected-resource.js";

export const OAUTH_WELL_KNOWN_ROUTE_BASE_PATH = "/.well-known";

export function createOAuthWellKnownRoutes(): AppRoutes<typeof OAUTH_WELL_KNOWN_ROUTE_BASE_PATH> {
  const routes = new Hono<AppContextBindings>();

  routes.get("/oauth-protected-resource/mcp", (ctx) => {
    if (!isConfiguredMcpProtectedResourceMetadataRequest(ctx)) {
      return ctx.notFound();
    }

    const config = ctx.get("config");
    return ctx.json(
      createMcpProtectedResourceMetadata({
        mcpResource: requireCanonicalMcpResourceUrl(config.mcp).toString(),
        authorizationServer: config.auth.baseUrl,
      }),
      200,
    );
  });

  routes.get("/oauth-authorization-server", (ctx) => {
    return ctx.json(
      createOAuthAuthorizationServerMetadata({ issuer: ctx.get("config").auth.baseUrl }),
      200,
    );
  });

  return {
    basePath: OAUTH_WELL_KNOWN_ROUTE_BASE_PATH,
    routes,
  };
}
