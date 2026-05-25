import { OpenAPIHono } from "@hono/zod-openapi";
import { OAuthGrantTypes } from "@mistle/db/control-plane";
import { BadRequestError, handleHttpError, HttpError } from "@mistle/http/errors.js";
import type { Context } from "hono";
import { z } from "zod";

import { requireActiveOrganizationAccess } from "../auth/services/organization-authorization.js";
import {
  isOrganizationPermission,
  type OrganizationPermission,
} from "../auth/services/organization-policy.js";
import { requireAuthSession } from "../middleware/require-auth-session.js";
import type { AppContextBindings, AppRoutes, AppSession } from "../types.js";
import { OAuthAuthorizeQuerySchema, OAuthTokenRequestSchema } from "./schemas.js";
import {
  createMistleCliAuthorizationCode,
  exchangeMistleCliAuthorizationCode,
} from "./services/authorization-code.js";
import { refreshOAuthTokenPair } from "./services/oauth-token.js";
import {
  requireMistleCliOAuthClient,
  validateMistleCliRedirectUri,
} from "./services/static-client-validation.js";

export const OAUTH_ROUTE_BASE_PATH = "/oauth";

export function createOAuthRoutes(): AppRoutes<typeof OAUTH_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.get("/authorize", async (ctx) => {
    const sessionErrorResponse = await requireAuthSession(ctx);
    if (sessionErrorResponse !== null) {
      if (sessionErrorResponse.status === 401) {
        return redirectToDashboardLogin(ctx);
      }

      return sessionErrorResponse;
    }

    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected OAuth authorize session to be available.");
    }

    try {
      const query = OAuthAuthorizeQuerySchema.parse(ctx.req.query());
      const db = ctx.get("db");
      const client = await requireMistleCliOAuthClient({
        db,
        clientId: query.client_id,
        grantType: OAuthGrantTypes.AUTHORIZATION_CODE,
      });
      await validateMistleCliRedirectUri({
        db,
        redirectUri: query.redirect_uri,
      });
      const permissions = await resolveAuthorizedPermissions({
        session,
        requestedScope: query.scope,
        clientPermissions: client.permissions,
        db,
      });
      const code = await createMistleCliAuthorizationCode({
        db,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        codeChallenge: query.code_challenge,
        userId: session.user.id,
        organizationId: session.activeOrganizationId,
        permissions,
      });

      const redirectUrl = new URL(query.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("state", query.state);

      return ctx.redirect(redirectUrl.toString(), 302);
    } catch (error) {
      return handleOAuthError(ctx, error);
    }
  });

  routes.post("/token", async (ctx) => {
    try {
      const body = OAuthTokenRequestSchema.parse(await ctx.req.parseBody());
      const db = ctx.get("db");
      const client = await requireMistleCliOAuthClient({
        db,
        clientId: body.client_id,
        grantType:
          body.grant_type === "authorization_code"
            ? OAuthGrantTypes.AUTHORIZATION_CODE
            : OAuthGrantTypes.REFRESH_TOKEN,
      });

      const result =
        body.grant_type === "authorization_code"
          ? await exchangeAuthorizationCodeToken({ db, body, oauthClientId: client.id })
          : await refreshOAuthTokenPair({
              db,
              oauthClientId: client.id,
              refreshToken: body.refresh_token,
            });

      return ctx.json(
        {
          token_type: "Bearer",
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          expires_in: result.expiresIn,
          scope: result.scope,
        },
        200,
      );
    } catch (error) {
      return handleOAuthError(ctx, error);
    }
  });

  return {
    basePath: OAUTH_ROUTE_BASE_PATH,
    routes,
  };
}

function redirectToDashboardLogin(ctx: Context<AppContextBindings>) {
  const dashboardLoginUrl = new URL("/auth/login", ctx.get("config").dashboard.baseUrl);
  dashboardLoginUrl.searchParams.set("redirectTo", ctx.req.url);

  return ctx.redirect(dashboardLoginUrl.toString(), 302);
}

async function exchangeAuthorizationCodeToken(input: {
  db: AppContextBindings["Variables"]["db"];
  body: Extract<z.output<typeof OAuthTokenRequestSchema>, { grant_type: "authorization_code" }>;
  oauthClientId: string;
}) {
  await validateMistleCliRedirectUri({
    db: input.db,
    redirectUri: input.body.redirect_uri,
  });

  return await exchangeMistleCliAuthorizationCode({
    db: input.db,
    oauthClientId: input.oauthClientId,
    clientId: input.body.client_id,
    redirectUri: input.body.redirect_uri,
    code: input.body.code,
    codeVerifier: input.body.code_verifier,
  });
}

async function resolveAuthorizedPermissions(input: {
  db: AppContextBindings["Variables"]["db"];
  session: AppSession;
  requestedScope: string | undefined;
  clientPermissions: readonly string[];
}): Promise<OrganizationPermission[]> {
  const authorization = await requireActiveOrganizationAccess({
    db: input.db,
    actorUserId: input.session.user.id,
    activeOrganizationId: input.session.activeOrganizationId,
  });
  const requestedPermissions =
    input.requestedScope === undefined
      ? input.clientPermissions
      : input.requestedScope.split(" ").filter((scope) => scope.length > 0);
  const clientPermissionSet = new Set(input.clientPermissions);
  const actorPermissionSet = new Set(authorization.permissions);
  const grantedPermissions: OrganizationPermission[] = [];

  for (const permission of requestedPermissions) {
    if (!isOrganizationPermission(permission)) {
      throw new BadRequestError("invalid_scope", `OAuth scope '${permission}' is invalid.`);
    }

    if (clientPermissionSet.has(permission) && actorPermissionSet.has(permission)) {
      grantedPermissions.push(permission);
    }
  }

  const uniqueGrantedPermissions = [...new Set(grantedPermissions)];

  if (uniqueGrantedPermissions.length === 0) {
    throw new BadRequestError("invalid_scope", "No requested OAuth scopes can be granted.");
  }

  return uniqueGrantedPermissions;
}

function handleOAuthError(ctx: Context<AppContextBindings>, error: unknown) {
  if (error instanceof z.ZodError) {
    return ctx.json(
      {
        error: "invalid_request",
        error_description: "OAuth request is invalid.",
      },
      400,
    );
  }

  if (error instanceof HttpError) {
    if (error.code.startsWith("invalid_") || error.code === "unauthorized_client") {
      return ctx.json(
        {
          error: error.code,
          error_description: error.message,
        },
        error.status,
      );
    }

    return handleHttpError(ctx, error);
  }

  throw error;
}
