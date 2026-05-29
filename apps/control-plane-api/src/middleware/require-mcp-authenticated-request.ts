import { UnauthorizedError } from "@mistle/http/errors.js";
import type { MiddlewareHandler } from "hono";

import {
  authenticateApiKeyToken,
  isApiKeyToken,
  parseBearerToken,
} from "../auth/services/api-key-authentication.js";
import { authenticateMcpToken } from "../auth/services/mcp-token-authentication.js";
import { createOAuthBearerChallenge } from "../oauth/well-known/challenge.js";
import {
  getMcpProtectedResourceMetadataUrl,
  isConfiguredMcpResourceRequest,
} from "../oauth/well-known/protected-resource.js";
import type { AppContextBindings } from "../types.js";

export function createRequireMcpAuthenticatedRequestMiddleware(): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    if (!isConfiguredMcpResourceRequest(ctx)) {
      return ctx.notFound();
    }

    const authorization = ctx.req.header("authorization") ?? null;
    const metadataUrl = getMcpProtectedResourceMetadataUrl(ctx.get("config").mcp);

    if (authorization !== null) {
      try {
        const bearerToken = parseBearerToken(authorization);
        if (bearerToken === null) {
          throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized MCP request.");
        }

        const authContext = isApiKeyToken(bearerToken)
          ? await authenticateApiKeyToken({
              db: ctx.get("db"),
              token: bearerToken,
            })
          : await authenticateMcpToken({
              db: ctx.get("db"),
              token: bearerToken,
              config: ctx.get("config").mcp.auth,
            });
        ctx.set("authContext", authContext);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          return ctx.text("Unauthorized MCP request.", 401, {
            "WWW-Authenticate": createOAuthBearerChallenge({
              kind: "invalid_token",
              metadataUrl,
            }),
          });
        }

        throw error;
      }

      await next();
      return;
    }

    return ctx.text("Unauthorized MCP request.", 401, {
      "WWW-Authenticate": createOAuthBearerChallenge({
        kind: "missing_token",
        metadataUrl,
      }),
    });
  };
}
