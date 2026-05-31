import { randomBytes } from "node:crypto";

import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  getControlPlaneDatabaseSchema,
  OAuthClientRegistrationKinds,
  OAuthGrantTypes,
} from "@mistle/db/control-plane";
import { buildUrlWithPath } from "@mistle/http";
import { BadRequestError, ForbiddenError, NotFoundError } from "@mistle/http/errors.js";
import { addMilliseconds, systemClock, type Clock } from "@mistle/time";
import { and, eq, isNull, sql } from "drizzle-orm";

import { requireOrganizationAccess } from "../../auth/services/organization-authorization.js";
import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import {
  OAuthAuthorizationConsentPayloadSchema,
  type OAuthAuthorizationConsentPayload,
} from "../schemas.js";
import { OAuthErrorCodes, createMistleCliAuthorizationCode } from "./authorization-code.js";
import { requireOAuthClient } from "./client-validation.js";

const AuthorizationConsentModelName = "oauth_authorization_consent";
const AuthorizationConsentTtlMs = 10 * 60 * 1000;

export type OAuthAuthorizationConsentDetails = {
  requestId: string;
  clientName: string;
  organizationName: string;
  resource: string;
  requestedScopes: readonly OrganizationPermission[];
  authorizationRestartUri: string;
};

export async function createOAuthAuthorizationConsentRequest(input: {
  db: ControlPlaneDatabase;
  clientId: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  state: string;
  userId: string;
  organizationId: string;
  requestedScopes: readonly OrganizationPermission[];
  authorizationRequestedScopes: readonly OrganizationPermission[];
  clock?: Clock;
}): Promise<string> {
  const requestId = generateOpaqueToken();
  const clock = input.clock ?? systemClock;
  const expiresAt = addMilliseconds(clock.nowDate(), AuthorizationConsentTtlMs).toISOString();
  const tables = getControlPlaneDatabaseSchema(input.db);

  await input.db.insert(tables.oauthServerStates).values({
    modelName: AuthorizationConsentModelName,
    recordId: requestId,
    payload: {
      kind: AuthorizationConsentModelName,
      clientId: input.clientId,
      clientName: input.clientName,
      redirectUri: input.redirectUri,
      resource: input.resource,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      state: input.state,
      userId: input.userId,
      organizationId: input.organizationId,
      requestedScopes: [...input.requestedScopes],
      authorizationRequestedScopes: [...input.authorizationRequestedScopes],
    } satisfies OAuthAuthorizationConsentPayload,
    expiresAt,
  });

  return requestId;
}

export async function getOAuthAuthorizationConsentDetails(input: {
  db: ControlPlaneDatabase;
  requestId: string;
  userId: string;
  organizationId: string;
  authBaseUrl: string;
  clock?: Clock;
}): Promise<OAuthAuthorizationConsentDetails> {
  const payload = await readPendingAuthorizationConsentPayload(input);
  const organization = await input.db.query.organizations.findFirst({
    columns: {
      name: true,
    },
    where: (table, { eq }) => eq(table.id, payload.organizationId),
  });
  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "OAuth consent request was not found.");
  }

  return {
    requestId: input.requestId,
    clientName: payload.clientName,
    organizationName: organization.name,
    resource: payload.resource,
    requestedScopes: payload.requestedScopes,
    authorizationRestartUri: createAuthorizationRestartUri({
      authBaseUrl: input.authBaseUrl,
      payload,
    }),
  };
}

export async function approveOAuthAuthorizationConsent(input: {
  db: ControlPlaneDatabase;
  requestId: string;
  userId: string;
  organizationId: string;
  approvedScopes: readonly OrganizationPermission[];
  mcpResource: string;
  clock?: Clock;
}): Promise<string> {
  return await input.db.transaction(async (tx) => {
    const payload = await readPendingAuthorizationConsentPayload({
      db: tx,
      requestId: input.requestId,
      userId: input.userId,
      organizationId: input.organizationId,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
    });
    const approvedScopeSet = new Set(input.approvedScopes);
    const requestedScopeSet = new Set(payload.requestedScopes);
    for (const scope of approvedScopeSet) {
      if (!requestedScopeSet.has(scope)) {
        throw new BadRequestError(OAuthErrorCodes.INVALID_SCOPE, "OAuth scope is invalid.");
      }
    }
    if (approvedScopeSet.size === 0) {
      throw new BadRequestError(OAuthErrorCodes.INVALID_SCOPE, "No OAuth scopes were approved.");
    }

    const client = await requireOAuthClient({
      db: tx,
      clientId: payload.clientId,
      grantType: OAuthGrantTypes.AUTHORIZATION_CODE,
      redirectUri: payload.redirectUri,
    });
    if (
      client.registrationKind !== OAuthClientRegistrationKinds.DYNAMIC ||
      payload.resource !== input.mcpResource
    ) {
      throw new BadRequestError(OAuthErrorCodes.INVALID_TARGET, "OAuth resource is invalid.");
    }
    const authorization = await requireOrganizationAccess({
      db: tx,
      actorUserId: payload.userId,
      organizationId: payload.organizationId,
    });
    const currentClientPermissions = new Set(client.permissions);
    const currentActorPermissions = new Set(authorization.permissions);
    for (const scope of approvedScopeSet) {
      if (!currentClientPermissions.has(scope) || !currentActorPermissions.has(scope)) {
        throw new BadRequestError(OAuthErrorCodes.INVALID_SCOPE, "OAuth scope is invalid.");
      }
    }

    await consumePendingAuthorizationConsent({
      db: tx,
      requestId: input.requestId,
      userId: input.userId,
      organizationId: input.organizationId,
      ...(input.clock === undefined ? {} : { clock: input.clock }),
    });

    const code = await createMistleCliAuthorizationCode({
      db: tx,
      clientId: payload.clientId,
      redirectUri: payload.redirectUri,
      resource: payload.resource,
      codeChallenge: payload.codeChallenge,
      userId: payload.userId,
      organizationId: payload.organizationId,
      permissions: [...approvedScopeSet],
      ...(input.clock === undefined ? {} : { clock: input.clock }),
    });

    const redirectUrl = new URL(payload.redirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", payload.state);
    return redirectUrl.toString();
  });
}

export async function denyOAuthAuthorizationConsent(input: {
  db: ControlPlaneDatabase;
  requestId: string;
  userId: string;
  organizationId: string;
  clock?: Clock;
}): Promise<string> {
  const payload = await readPendingAuthorizationConsentPayload(input);
  await consumePendingAuthorizationConsent(input);
  const redirectUrl = new URL(payload.redirectUri);
  redirectUrl.searchParams.set("error", "access_denied");
  redirectUrl.searchParams.set("state", payload.state);
  return redirectUrl.toString();
}

async function readPendingAuthorizationConsentPayload(input: {
  db: ControlPlaneDatabase;
  requestId: string;
  userId: string;
  organizationId: string;
  clock?: Clock;
}): Promise<OAuthAuthorizationConsentPayload> {
  const clock = input.clock ?? systemClock;
  const state = await input.db.query.oauthServerStates.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.modelName, AuthorizationConsentModelName), eq(table.recordId, input.requestId)),
  });
  if (state === undefined || state.consumedAt !== null) {
    throw new NotFoundError("NOT_FOUND", "OAuth consent request was not found.");
  }
  if (state.expiresAt === null || Date.parse(state.expiresAt) <= clock.nowMs()) {
    throw new NotFoundError("NOT_FOUND", "OAuth consent request was not found.");
  }

  const payload = OAuthAuthorizationConsentPayloadSchema.parse(state.payload);
  if (payload.userId !== input.userId || payload.organizationId !== input.organizationId) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  return payload;
}

async function consumePendingAuthorizationConsent(input: {
  db: ControlPlaneDatabase;
  requestId: string;
  userId: string;
  organizationId: string;
  clock?: Clock;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const [consumedState] = await input.db
    .update(tables.oauthServerStates)
    .set({
      consumedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.oauthServerStates.modelName, AuthorizationConsentModelName),
        eq(tables.oauthServerStates.recordId, input.requestId),
        isNull(tables.oauthServerStates.consumedAt),
      ),
    )
    .returning({ id: tables.oauthServerStates.id });
  if (consumedState === undefined) {
    throw new NotFoundError("NOT_FOUND", "OAuth consent request was not found.");
  }
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function createAuthorizationRestartUri(input: {
  authBaseUrl: string;
  payload: OAuthAuthorizationConsentPayload;
}): string {
  const url = new URL(buildUrlWithPath(input.authBaseUrl, "/oauth/authorize"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.payload.clientId);
  url.searchParams.set("redirect_uri", input.payload.redirectUri);
  url.searchParams.set("resource", input.payload.resource);
  url.searchParams.set("scope", input.payload.authorizationRequestedScopes.join(" "));
  url.searchParams.set("state", input.payload.state);
  url.searchParams.set("code_challenge", input.payload.codeChallenge);
  url.searchParams.set("code_challenge_method", input.payload.codeChallengeMethod);

  return url.toString();
}
