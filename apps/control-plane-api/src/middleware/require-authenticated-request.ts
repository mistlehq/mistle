import { handleHttpError, UnauthorizedError } from "@mistle/http/errors.js";
import type { MiddlewareHandler } from "hono";

import {
  authenticateApiKeyToken,
  isApiKeyToken,
  parseBearerToken,
} from "../auth/services/api-key-authentication.js";
import { authenticateOAuthAccessToken } from "../oauth/services/oauth-token.js";
import type { AppContextBindings } from "../types.js";
import { requireAuthSession } from "./require-auth-session.js";

export function createRequireAuthenticatedRequestMiddleware(): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const authorization = ctx.req.header("authorization") ?? null;

    if (authorization !== null) {
      try {
        const bearerToken = parseBearerToken(authorization);
        if (bearerToken === null) {
          throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
        }

        const db = ctx.get("db");
        const authContext = isApiKeyToken(bearerToken)
          ? await authenticateApiKeyToken({ db, token: bearerToken })
          : await authenticateOAuthAccessToken({ db, token: bearerToken });
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
