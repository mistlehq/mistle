import { OpenAPIHono } from "@hono/zod-openapi";
import { OAuthClientRegistrationKinds, OAuthGrantTypes } from "@mistle/db/control-plane";
import {
  BadRequestError,
  handleHttpError,
  HttpError,
  OpenApiValidationHook,
} from "@mistle/http/errors.js";
import type { Context } from "hono";
import { z } from "zod";

import { requireActiveOrganizationAccess } from "../auth/services/organization-authorization.js";
import {
  isOrganizationPermission,
  type OrganizationPermission,
} from "../auth/services/organization-policy.js";
import { requireAuthSession } from "../middleware/require-auth-session.js";
import type { AppContextBindings, AppRoutes, AppSession } from "../types.js";
import { MistleCliOAuthClient } from "./clients.js";
import {
  OAuthAuthorizeQuerySchema,
  OAuthClientRegistrationRequestSchema,
  OAuthConsentApprovalRequestSchema,
  OAuthTokenRequestSchema,
} from "./schemas.js";
import {
  createMistleCliAuthorizationCode,
  exchangeMistleCliAuthorizationCode,
  OAuthErrorCodes,
} from "./services/authorization-code.js";
import {
  approveOAuthAuthorizationConsent,
  createOAuthAuthorizationConsentRequest,
  denyOAuthAuthorizationConsent,
  getOAuthAuthorizationConsentDetails,
} from "./services/authorization-consent.js";
import { registerDynamicOAuthClient } from "./services/client-registration.js";
import { requireOAuthClient } from "./services/client-validation.js";
import { refreshOAuthTokenPair } from "./services/oauth-token.js";
import { buildPublicRequestUrl } from "./services/public-request-url.js";
import * as switchOrganization from "./switch-organization/index.js";
import { requireCanonicalMcpResourceUrl } from "./well-known/protected-resource.js";

export const OAUTH_ROUTE_BASE_PATH = "/oauth";

export function createOAuthRoutes(): AppRoutes<typeof OAUTH_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.get("/authorize", async (ctx) => {
    try {
      const query = OAuthAuthorizeQuerySchema.parse(ctx.req.query());
      const db = ctx.get("db");
      const client = await requireOAuthClient({
        db,
        clientId: query.client_id,
        grantType: OAuthGrantTypes.AUTHORIZATION_CODE,
        redirectUri: query.redirect_uri,
      });
      try {
        requireAuthorizeResource({
          resource: query.resource,
          clientId: client.clientId,
          registrationKind: client.registrationKind,
          controlPlaneResource: ctx.get("config").auth.baseUrl,
          mcpResource: requireCanonicalMcpResourceUrl(ctx.get("config").mcp).toString(),
        });
      } catch (error) {
        return handleAuthorizeRedirectableOAuthError(ctx, {
          error,
          redirectUri: query.redirect_uri,
          state: query.state,
        });
      }
      let requestedPermissions: OrganizationPermission[];
      try {
        requestedPermissions = resolveRequestedClientPermissions({
          requestedScope: query.scope,
          clientPermissions: client.permissions,
        });
      } catch (error) {
        return handleAuthorizeRedirectableOAuthError(ctx, {
          error,
          redirectUri: query.redirect_uri,
          state: query.state,
        });
      }

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

      let permissions: OrganizationPermission[];
      try {
        permissions = await resolveAuthorizedPermissions({
          session,
          requestedPermissions,
          db,
        });
      } catch (error) {
        return handleAuthorizeRedirectableOAuthError(ctx, {
          error,
          redirectUri: query.redirect_uri,
          state: query.state,
        });
      }
      if (client.registrationKind === OAuthClientRegistrationKinds.DYNAMIC) {
        const requestId = await createOAuthAuthorizationConsentRequest({
          db,
          clientId: client.clientId,
          clientName: client.name,
          redirectUri: query.redirect_uri,
          resource: query.resource,
          codeChallenge: query.code_challenge,
          state: query.state,
          userId: session.user.id,
          organizationId: session.activeOrganizationId,
          requestedScopes: permissions,
        });
        return ctx.redirect(createDashboardConsentUrl(ctx, requestId), 302);
      }

      const code = await createMistleCliAuthorizationCode({
        db,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        resource: query.resource,
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
      const client = await requireOAuthClient({
        db,
        clientId: body.client_id,
        grantType:
          body.grant_type === "authorization_code"
            ? OAuthGrantTypes.AUTHORIZATION_CODE
            : OAuthGrantTypes.REFRESH_TOKEN,
        ...(body.grant_type === "authorization_code" ? { redirectUri: body.redirect_uri } : {}),
      });
      if (client.clientId === MistleCliOAuthClient.clientId) {
        const resourceError = validateMistleCliResource({
          resource: body.resource,
          expectedResource: ctx.get("config").auth.baseUrl,
        });
        if (resourceError !== null) {
          throw resourceError;
        }
      }

      const result =
        body.grant_type === "authorization_code"
          ? await exchangeAuthorizationCodeToken({ db, body, oauthClientId: client.id })
          : await refreshOAuthTokenPair({
              db,
              oauthClientId: client.id,
              refreshToken: body.refresh_token,
              resource: body.resource,
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

  routes.post("/register", async (ctx) => {
    try {
      const body = OAuthClientRegistrationRequestSchema.parse(await ctx.req.json<unknown>());
      const response = await registerDynamicOAuthClient({
        db: ctx.get("db"),
        request: body,
      });

      return ctx.json(response, 201);
    } catch (error) {
      return handleOAuthError(ctx, error);
    }
  });

  routes.get("/consent/:requestId", async (ctx) => {
    const sessionErrorResponse = await requireAuthSession(ctx);
    if (sessionErrorResponse !== null) {
      return sessionErrorResponse;
    }
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected OAuth consent session to be available.");
    }

    try {
      const details = await getOAuthAuthorizationConsentDetails({
        db: ctx.get("db"),
        requestId: ctx.req.param("requestId"),
        userId: session.user.id,
        organizationId: session.activeOrganizationId,
      });

      return ctx.json(details, 200);
    } catch (error) {
      return handleHttpError(ctx, error);
    }
  });

  routes.post("/consent/:requestId/approve", async (ctx) => {
    const sessionErrorResponse = await requireAuthSession(ctx);
    if (sessionErrorResponse !== null) {
      return sessionErrorResponse;
    }
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected OAuth consent session to be available.");
    }

    try {
      const body = OAuthConsentApprovalRequestSchema.parse(await ctx.req.json<unknown>());
      const redirectUri = await approveOAuthAuthorizationConsent({
        db: ctx.get("db"),
        requestId: ctx.req.param("requestId"),
        userId: session.user.id,
        organizationId: session.activeOrganizationId,
        approvedScopes: body.scopes,
        mcpResource: requireCanonicalMcpResourceUrl(ctx.get("config").mcp).toString(),
      });

      return ctx.json({ redirectUri }, 200);
    } catch (error) {
      return handleOAuthError(ctx, error);
    }
  });

  routes.post("/consent/:requestId/deny", async (ctx) => {
    const sessionErrorResponse = await requireAuthSession(ctx);
    if (sessionErrorResponse !== null) {
      return sessionErrorResponse;
    }
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected OAuth consent session to be available.");
    }

    try {
      const redirectUri = await denyOAuthAuthorizationConsent({
        db: ctx.get("db"),
        requestId: ctx.req.param("requestId"),
        userId: session.user.id,
        organizationId: session.activeOrganizationId,
      });

      return ctx.json({ redirectUri }, 200);
    } catch (error) {
      return handleHttpError(ctx, error);
    }
  });

  routes.openapi(switchOrganization.route, switchOrganization.handler);

  return {
    basePath: OAUTH_ROUTE_BASE_PATH,
    routes,
  };
}

function redirectToDashboardLogin(ctx: Context<AppContextBindings>) {
  const dashboardLoginUrl = new URL("/auth/login", ctx.get("config").dashboard.baseUrl);
  dashboardLoginUrl.searchParams.set(
    "redirectTo",
    buildPublicRequestUrl({
      publicBaseUrl: ctx.get("config").auth.baseUrl,
      requestUrl: ctx.req.url,
    }),
  );

  return ctx.redirect(dashboardLoginUrl.toString(), 302);
}

function createDashboardConsentUrl(ctx: Context<AppContextBindings>, requestId: string): string {
  return new URL(
    `/auth/oauth/consent/${requestId}`,
    ctx.get("config").dashboard.baseUrl,
  ).toString();
}

async function exchangeAuthorizationCodeToken(input: {
  db: AppContextBindings["Variables"]["db"];
  body: Extract<z.output<typeof OAuthTokenRequestSchema>, { grant_type: "authorization_code" }>;
  oauthClientId: string;
}) {
  return await exchangeMistleCliAuthorizationCode({
    db: input.db,
    oauthClientId: input.oauthClientId,
    clientId: input.body.client_id,
    redirectUri: input.body.redirect_uri,
    code: input.body.code,
    codeVerifier: input.body.code_verifier,
    resource: input.body.resource,
  });
}

function validateMistleCliResource(input: {
  resource: string;
  expectedResource: string;
}): BadRequestError | null {
  if (input.resource !== input.expectedResource) {
    return new BadRequestError(OAuthErrorCodes.INVALID_TARGET, "OAuth resource is invalid.");
  }

  return null;
}

function requireAuthorizeResource(input: {
  resource: string;
  clientId: string;
  registrationKind:
    | typeof OAuthClientRegistrationKinds.STATIC
    | typeof OAuthClientRegistrationKinds.DYNAMIC;
  controlPlaneResource: string;
  mcpResource: string;
}): void {
  const expectedResource =
    input.registrationKind === OAuthClientRegistrationKinds.DYNAMIC
      ? input.mcpResource
      : input.controlPlaneResource;
  if (
    input.clientId === MistleCliOAuthClient.clientId ||
    input.registrationKind === OAuthClientRegistrationKinds.DYNAMIC
  ) {
    const resourceError = validateMistleCliResource({
      resource: input.resource,
      expectedResource,
    });
    if (resourceError !== null) {
      throw resourceError;
    }
    return;
  }

  throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
}

async function resolveAuthorizedPermissions(input: {
  db: AppContextBindings["Variables"]["db"];
  session: AppSession;
  requestedPermissions: readonly OrganizationPermission[];
}): Promise<OrganizationPermission[]> {
  const authorization = await requireActiveOrganizationAccess({
    db: input.db,
    actorUserId: input.session.user.id,
    activeOrganizationId: input.session.activeOrganizationId,
  });
  const actorPermissionSet = new Set(authorization.permissions);
  const grantedPermissions: OrganizationPermission[] = [];

  for (const permission of input.requestedPermissions) {
    if (actorPermissionSet.has(permission)) {
      grantedPermissions.push(permission);
    }
  }

  const uniqueGrantedPermissions = [...new Set(grantedPermissions)];

  if (uniqueGrantedPermissions.length === 0) {
    throw new BadRequestError("invalid_scope", "No requested OAuth scopes can be granted.");
  }

  return uniqueGrantedPermissions;
}

function resolveRequestedClientPermissions(input: {
  requestedScope: string | undefined;
  clientPermissions: readonly string[];
}): OrganizationPermission[] {
  const requestedPermissions =
    input.requestedScope === undefined
      ? input.clientPermissions
      : input.requestedScope.split(" ").filter((scope) => scope.length > 0);
  const clientPermissionSet = new Set(input.clientPermissions);
  const allowedPermissions: OrganizationPermission[] = [];

  for (const permission of requestedPermissions) {
    if (!isOrganizationPermission(permission)) {
      throw new BadRequestError("invalid_scope", `OAuth scope '${permission}' is invalid.`);
    }
    if (!clientPermissionSet.has(permission)) {
      throw new BadRequestError("invalid_scope", `OAuth scope '${permission}' is not allowed.`);
    }

    allowedPermissions.push(permission);
  }

  const uniqueAllowedPermissions = [...new Set(allowedPermissions)];
  if (uniqueAllowedPermissions.length === 0) {
    throw new BadRequestError("invalid_scope", "No requested OAuth scopes can be granted.");
  }

  return uniqueAllowedPermissions;
}

function handleOAuthError(ctx: Context<AppContextBindings>, error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return ctx.json(
      {
        error: "invalid_request",
        error_description: "OAuth request is invalid.",
      },
      400,
    );
  }

  if (error instanceof HttpError) {
    if (
      error.code.startsWith("invalid_") ||
      error.code === "unauthorized_client" ||
      error.code === OAuthErrorCodes.INVALID_TARGET
    ) {
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

function handleAuthorizeRedirectableOAuthError(
  ctx: Context<AppContextBindings>,
  input: {
    error: unknown;
    redirectUri: string;
    state: string;
  },
) {
  if (input.error instanceof HttpError && input.error.code === OAuthErrorCodes.INVALID_SCOPE) {
    const redirectUrl = new URL(input.redirectUri);
    redirectUrl.searchParams.set("error", input.error.code);
    redirectUrl.searchParams.set("error_description", input.error.message);
    redirectUrl.searchParams.set("state", input.state);
    return ctx.redirect(redirectUrl.toString(), 302);
  }

  return handleOAuthError(ctx, input.error);
}
