import { handleHttpError, UnauthorizedError } from "@mistle/http/errors.js";
import type { MiddlewareHandler } from "hono";

import {
  authenticateApiKeyToken,
  isApiKeyToken,
  parseBearerToken,
} from "../auth/services/api-key-authentication.js";
import { authenticateMcpToken } from "../auth/services/mcp-token-authentication.js";
import type { AppContextBindings } from "../types.js";
import { requireAuthSession } from "./require-auth-session.js";

export function createRequireMcpAuthenticatedRequestMiddleware(): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const authorization = ctx.req.header("authorization") ?? null;

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
        return handleHttpError(ctx, error);
      }

      await next();
      return;
    }

    const authSessionErrorResponse = await requireAuthSession(ctx);
    if (authSessionErrorResponse !== null) {
      return authSessionErrorResponse;
    }

    await next();
  };
}
