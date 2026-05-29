import { ForbiddenError, NotFoundError, UnauthorizedError } from "@mistle/http/errors.js";
import type { Context, MiddlewareHandler } from "hono";

import {
  authenticateApiKeyToken,
  isApiKeyToken,
  parseBearerToken,
} from "../auth/services/api-key-authentication.js";
import { authenticateMcpToken } from "../auth/services/mcp-token-authentication.js";
import { authenticateOAuthAccessToken, isOAuthAccessToken } from "../oauth/services/oauth-token.js";
import { createOAuthBearerChallenge } from "../oauth/well-known/challenge.js";
import {
  getMcpProtectedResourceMetadataUrl,
  isConfiguredMcpResourceRequest,
  requireCanonicalMcpResourceUrl,
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

        const authContext = await authenticateMcpBearerToken({
          bearerToken,
          ctx,
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

async function authenticateMcpBearerToken(input: {
  bearerToken: string;
  ctx: Context<AppContextBindings>;
}) {
  if (isApiKeyToken(input.bearerToken)) {
    return await authenticateApiKeyToken({
      db: input.ctx.get("db"),
      token: input.bearerToken,
    });
  }

  if (isOAuthAccessToken(input.bearerToken)) {
    const authContext = await authenticateMcpOAuthAccessToken(input);
    const mcpResource = requireCanonicalMcpResourceUrl(input.ctx.get("config").mcp).toString();
    if (authContext.oauth.resource !== mcpResource) {
      throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized MCP request.");
    }

    return authContext;
  }

  return await authenticateMcpToken({
    db: input.ctx.get("db"),
    token: input.bearerToken,
    config: input.ctx.get("config").mcp.auth,
  });
}

async function authenticateMcpOAuthAccessToken(input: {
  bearerToken: string;
  ctx: Context<AppContextBindings>;
}) {
  try {
    return await authenticateOAuthAccessToken({
      db: input.ctx.get("db"),
      token: input.bearerToken,
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized MCP request.");
    }

    throw error;
  }
}
