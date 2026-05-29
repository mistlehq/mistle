import type { RouteHandler } from "@hono/zod-openapi";
import type { z } from "@hono/zod-openapi";
import { UnauthorizedError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { parseBearerToken } from "../../auth/services/api-key-authentication.js";
import type { AppContextBindings } from "../../types.js";
import { OAuthTokenResponseSchema } from "../schemas.js";
import { switchOAuthOrganizationTokenPair } from "../services/oauth-token.js";
import { route } from "./route.js";

type OAuthTokenResponse = z.output<typeof OAuthTokenResponseSchema>;

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const bearerToken = parseBearerToken(ctx.req.header("authorization") ?? null);
  if (bearerToken === null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const body = ctx.req.valid("json");
  const result = await switchOAuthOrganizationTokenPair({
    db: ctx.get("db"),
    accessToken: bearerToken,
    organizationId: body.organizationId,
    expectedResource: ctx.get("config").auth.baseUrl,
  });

  const responseBody: OAuthTokenResponse = {
    token_type: "Bearer",
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_in: result.expiresIn,
    scope: result.scope,
  };

  return ctx.json(responseBody, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
