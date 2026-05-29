import { randomBytes } from "node:crypto";

import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { addMilliseconds, systemClock, type Clock } from "@mistle/time";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import {
  OAuthAuthorizationCodePayloadSchema,
  type OAuthAuthorizationCodePayload,
} from "../schemas.js";
import { createOAuthGrantTokenPair } from "./oauth-token.js";
import { verifyS256Pkce } from "./pkce.js";

const AuthorizationCodeModelName = "mistle_cli_authorization_code";
const AuthorizationCodeTtlMs = 10 * 60 * 1000;

export const OAuthErrorCodes: {
  INVALID_REQUEST: string;
  INVALID_GRANT: string;
  INVALID_SCOPE: string;
  INVALID_TARGET: string;
  UNAUTHORIZED_CLIENT: string;
} = {
  INVALID_REQUEST: "invalid_request",
  INVALID_GRANT: "invalid_grant",
  INVALID_SCOPE: "invalid_scope",
  INVALID_TARGET: "invalid_target",
  UNAUTHORIZED_CLIENT: "unauthorized_client",
};

export async function createMistleCliAuthorizationCode(input: {
  db: ControlPlaneDatabase;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  userId: string;
  organizationId: string;
  permissions: readonly OrganizationPermission[];
  clock?: Clock;
}): Promise<string> {
  const code = generateOpaqueToken();
  const clock = input.clock ?? systemClock;
  const expiresAt = addMilliseconds(clock.nowDate(), AuthorizationCodeTtlMs).toISOString();
  const tables = getControlPlaneDatabaseSchema(input.db);

  await input.db.insert(tables.oauthServerStates).values({
    modelName: AuthorizationCodeModelName,
    recordId: code,
    payload: createAuthorizationCodePayload({
      kind: AuthorizationCodeModelName,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      resource: input.resource,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      userId: input.userId,
      organizationId: input.organizationId,
      permissions: [...input.permissions],
    }),
    expiresAt,
  });

  return code;
}

export async function exchangeMistleCliAuthorizationCode(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  code: string;
  codeVerifier: string;
  clock?: Clock;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const clock = input.clock ?? systemClock;

  return await input.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const state = await tx.query.oauthServerStates.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.modelName, AuthorizationCodeModelName), eq(table.recordId, input.code)),
    });

    if (state === undefined) {
      throw invalidGrant("Authorization code is invalid.");
    }
    if (state.consumedAt !== null) {
      throw invalidGrant("Authorization code has already been used.");
    }
    if (state.expiresAt === null || Date.parse(state.expiresAt) <= clock.nowMs()) {
      throw invalidGrant("Authorization code has expired.");
    }

    const payload = OAuthAuthorizationCodePayloadSchema.parse(state.payload);
    if (payload.clientId !== input.clientId) {
      throw invalidGrant("Authorization code client does not match.");
    }
    if (payload.redirectUri !== input.redirectUri) {
      throw invalidGrant("Authorization code redirect URI does not match.");
    }
    if (payload.resource !== input.resource) {
      throw invalidGrant("Authorization code resource does not match.");
    }
    if (
      !verifyS256Pkce({
        codeVerifier: input.codeVerifier,
        codeChallenge: payload.codeChallenge,
      })
    ) {
      throw invalidGrant("Authorization code verifier is invalid.");
    }

    const [consumedState] = await tx
      .update(tables.oauthServerStates)
      .set({
        consumedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(tables.oauthServerStates.id, state.id), isNull(tables.oauthServerStates.consumedAt)),
      )
      .returning({ id: tables.oauthServerStates.id });

    if (consumedState === undefined) {
      throw invalidGrant("Authorization code has already been used.");
    }

    const tokenPair = await createOAuthGrantTokenPair({
      db: tx,
      oauthClientId: input.oauthClientId,
      userId: payload.userId,
      organizationId: payload.organizationId,
      resource: payload.resource,
      permissions: payload.permissions,
      clock,
    });

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      scope: tokenPair.scope,
    };
  });
}

function createAuthorizationCodePayload(
  payload: OAuthAuthorizationCodePayload,
): OAuthAuthorizationCodePayload {
  return payload;
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function invalidGrant(message: string): BadRequestError {
  return new BadRequestError(OAuthErrorCodes.INVALID_GRANT, message);
}
