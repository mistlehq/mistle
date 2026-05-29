import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getControlPlaneDatabaseSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, UnauthorizedError } from "@mistle/http/errors.js";
import { addMilliseconds, systemClock, type Clock } from "@mistle/time";
import { eq, sql } from "drizzle-orm";

import { parseApiKeyPermissions } from "../../api-keys/services/permissions.js";
import { requireOrganizationAccess } from "../../auth/services/organization-authorization.js";
import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import type { AppAuthContext } from "../../types.js";

const AccessTokenPrefix = "mstl_oat_";
const RefreshTokenPrefix = "mstl_ort_";
const TokenLookupPrefixLength = 24;
const TokenHashAlgorithm = "sha256_v1";
export const OAuthAccessTokenExpiresInSeconds = 60 * 60;
const OAuthAccessTokenTtlMs = OAuthAccessTokenExpiresInSeconds * 1000;

type OAuthTokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  expiresIn: number;
  scope: string;
};

export async function createOAuthGrantTokenPair(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  userId: string;
  organizationId: string;
  permissions: readonly OrganizationPermission[];
  clock?: Clock;
}): Promise<OAuthTokenPair> {
  const clock = input.clock ?? systemClock;
  const tables = getControlPlaneDatabaseSchema(input.db);
  const accessToken = generateToken(AccessTokenPrefix);
  const refreshToken = generateToken(RefreshTokenPrefix);
  const expiresAt = addMilliseconds(clock.nowDate(), OAuthAccessTokenTtlMs).toISOString();

  const [grant] = await input.db
    .insert(tables.oauthGrants)
    .values({
      oauthClientId: input.oauthClientId,
      userId: input.userId,
      organizationId: input.organizationId,
    })
    .returning({ id: tables.oauthGrants.id });

  if (grant === undefined) {
    throw new Error("Failed to create OAuth grant.");
  }

  await input.db.insert(tables.oauthGrantScopes).values(
    input.permissions.map((permission) => ({
      oauthGrantId: grant.id,
      scope: permission,
    })),
  );
  await insertAccessToken({ db: input.db, oauthGrantId: grant.id, token: accessToken, expiresAt });
  await insertRefreshToken({ db: input.db, oauthGrantId: grant.id, token: refreshToken });

  return {
    accessToken,
    refreshToken,
    expiresAt,
    expiresIn: OAuthAccessTokenExpiresInSeconds,
    scope: input.permissions.join(" "),
  };
}

export async function refreshOAuthTokenPair(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  refreshToken: string;
  clock?: Clock;
}): Promise<OAuthTokenPair> {
  const clock = input.clock ?? systemClock;
  const refreshTokenRow = await requireRefreshToken({
    db: input.db,
    token: input.refreshToken,
    clock,
  });
  const grant = await input.db.query.oauthGrants.findFirst({
    columns: {
      id: true,
      oauthClientId: true,
      userId: true,
      organizationId: true,
      revokedAt: true,
    },
    where: (table, { eq }) => eq(table.id, refreshTokenRow.oauthGrantId),
  });

  if (grant === undefined || grant.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (grant.oauthClientId !== input.oauthClientId) {
    throw new BadRequestError("invalid_grant", "Refresh token client does not match.");
  }

  const permissions = await readCurrentlyAuthorizedGrantPermissions({
    db: input.db,
    grant,
  });
  const accessToken = generateToken(AccessTokenPrefix);
  const expiresAt = addMilliseconds(clock.nowDate(), OAuthAccessTokenTtlMs).toISOString();
  await insertAccessToken({ db: input.db, oauthGrantId: grant.id, token: accessToken, expiresAt });

  return {
    accessToken,
    refreshToken: input.refreshToken,
    expiresAt,
    expiresIn: OAuthAccessTokenExpiresInSeconds,
    scope: permissions.join(" "),
  };
}

export async function switchOAuthOrganizationTokenPair(input: {
  db: ControlPlaneDatabase;
  accessToken: string;
  organizationId: string;
  clock?: Clock;
}): Promise<OAuthTokenPair> {
  const authContext = await authenticateOAuthAccessToken({
    db: input.db,
    token: input.accessToken,
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
  const sourceGrant = await input.db.query.oauthGrants.findFirst({
    columns: {
      id: true,
      oauthClientId: true,
      userId: true,
      revokedAt: true,
    },
    where: (table, { eq }) => eq(table.id, authContext.oauth.grantId),
  });

  if (sourceGrant === undefined || sourceGrant.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const permissions = await readCurrentlyAuthorizedGrantPermissions({
    db: input.db,
    grant: {
      id: sourceGrant.id,
      oauthClientId: sourceGrant.oauthClientId,
      userId: sourceGrant.userId,
      organizationId: input.organizationId,
    },
  });

  if (permissions.length === 0) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  return createOAuthGrantTokenPair({
    db: input.db,
    oauthClientId: sourceGrant.oauthClientId,
    userId: sourceGrant.userId,
    organizationId: input.organizationId,
    permissions,
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
}

export async function authenticateOAuthAccessToken(input: {
  db: ControlPlaneDatabase;
  token: string;
  clock?: Clock;
}): Promise<Extract<AppAuthContext, { kind: "oauth" }>> {
  const tokenPrefix = parseTokenPrefix(input.token, AccessTokenPrefix);
  if (tokenPrefix === null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const accessToken = await input.db.query.oauthAccessTokens.findFirst({
    columns: {
      id: true,
      oauthGrantId: true,
      tokenHash: true,
      tokenHashAlgorithm: true,
      expiresAt: true,
      revokedAt: true,
    },
    where: (table, { eq }) => eq(table.tokenPrefix, tokenPrefix),
  });

  if (accessToken === undefined || accessToken.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (accessToken.tokenHashAlgorithm !== TokenHashAlgorithm) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (!secureEqual(hashToken(input.token), accessToken.tokenHash)) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const clock = input.clock ?? systemClock;
  if (Date.parse(accessToken.expiresAt) <= clock.nowMs()) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const grant = await input.db.query.oauthGrants.findFirst({
    columns: {
      id: true,
      oauthClientId: true,
      userId: true,
      organizationId: true,
      revokedAt: true,
    },
    where: (table, { eq }) => eq(table.id, accessToken.oauthGrantId),
  });
  if (grant === undefined || grant.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const permissions = await readCurrentlyAuthorizedGrantPermissions({
    db: input.db,
    grant,
  });
  const tables = getControlPlaneDatabaseSchema(input.db);
  await input.db
    .update(tables.oauthAccessTokens)
    .set({
      lastUsedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.oauthAccessTokens.id, accessToken.id));

  return {
    kind: "oauth",
    oauth: {
      grantId: grant.id,
      userId: grant.userId,
      organizationId: grant.organizationId,
    },
    permissions,
  };
}

async function insertAccessToken(input: {
  db: ControlPlaneDatabase;
  oauthGrantId: string;
  token: string;
  expiresAt: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  await input.db.insert(tables.oauthAccessTokens).values({
    oauthGrantId: input.oauthGrantId,
    tokenPrefix: requireTokenPrefix(input.token, AccessTokenPrefix),
    tokenHash: hashToken(input.token),
    tokenHashAlgorithm: TokenHashAlgorithm,
    expiresAt: input.expiresAt,
  });
}

async function insertRefreshToken(input: {
  db: ControlPlaneDatabase;
  oauthGrantId: string;
  token: string;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  await input.db.insert(tables.oauthRefreshTokens).values({
    oauthGrantId: input.oauthGrantId,
    tokenPrefix: requireTokenPrefix(input.token, RefreshTokenPrefix),
    tokenHash: hashToken(input.token),
    tokenHashAlgorithm: TokenHashAlgorithm,
  });
}

async function requireRefreshToken(input: {
  db: ControlPlaneDatabase;
  token: string;
  clock: Clock;
}): Promise<{ id: string; oauthGrantId: string }> {
  const tokenPrefix = parseTokenPrefix(input.token, RefreshTokenPrefix);
  if (tokenPrefix === null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const refreshToken = await input.db.query.oauthRefreshTokens.findFirst({
    columns: {
      id: true,
      oauthGrantId: true,
      tokenHash: true,
      tokenHashAlgorithm: true,
      expiresAt: true,
      revokedAt: true,
    },
    where: (table, { eq }) => eq(table.tokenPrefix, tokenPrefix),
  });
  if (refreshToken === undefined || refreshToken.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (refreshToken.tokenHashAlgorithm !== TokenHashAlgorithm) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (!secureEqual(hashToken(input.token), refreshToken.tokenHash)) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }
  if (
    refreshToken.expiresAt !== null &&
    Date.parse(refreshToken.expiresAt) <= input.clock.nowMs()
  ) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  await input.db
    .update(tables.oauthRefreshTokens)
    .set({
      lastUsedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.oauthRefreshTokens.id, refreshToken.id));

  return {
    id: refreshToken.id,
    oauthGrantId: refreshToken.oauthGrantId,
  };
}

async function readGrantPermissions(input: {
  db: ControlPlaneDatabase;
  oauthGrantId: string;
}): Promise<OrganizationPermission[]> {
  const scopes = await input.db.query.oauthGrantScopes.findMany({
    columns: {
      scope: true,
    },
    where: (table, { eq }) => eq(table.oauthGrantId, input.oauthGrantId),
  });

  return parseApiKeyPermissions(scopes.map((scope) => scope.scope));
}

async function readCurrentlyAuthorizedGrantPermissions(input: {
  db: ControlPlaneDatabase;
  grant: {
    id: string;
    oauthClientId: string;
    userId: string;
    organizationId: string;
  };
}): Promise<OrganizationPermission[]> {
  const grantPermissions = await readGrantPermissions({
    db: input.db,
    oauthGrantId: input.grant.id,
  });
  const clientPermissions = await readClientPermissions({
    db: input.db,
    oauthClientId: input.grant.oauthClientId,
  });
  const authorization = await requireOrganizationAccess({
    db: input.db,
    actorUserId: input.grant.userId,
    organizationId: input.grant.organizationId,
  });
  const configuredClientPermissions = new Set(clientPermissions);
  const currentlyAllowedPermissions = new Set(authorization.permissions);

  return grantPermissions.filter(
    (permission) =>
      configuredClientPermissions.has(permission) && currentlyAllowedPermissions.has(permission),
  );
}

async function readClientPermissions(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
}): Promise<OrganizationPermission[]> {
  const scopes = await input.db.query.oauthClientScopes.findMany({
    columns: {
      scope: true,
    },
    where: (table, { eq }) => eq(table.oauthClientId, input.oauthClientId),
  });

  return parseApiKeyPermissions(scopes.map((scope) => scope.scope));
}

function generateToken(prefix: string): string {
  return `${prefix}${randomBytes(48).toString("base64url")}`;
}

function requireTokenPrefix(token: string, expectedPrefix: string): string {
  const tokenPrefix = parseTokenPrefix(token, expectedPrefix);
  if (tokenPrefix === null) {
    throw new Error("Generated OAuth token is invalid.");
  }

  return tokenPrefix;
}

function parseTokenPrefix(token: string, expectedPrefix: string): string | null {
  if (!token.startsWith(expectedPrefix) || token.length <= TokenLookupPrefixLength) {
    return null;
  }

  return token.slice(0, TokenLookupPrefixLength);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isOAuthAccessToken(token: string): boolean {
  return parseTokenPrefix(token, AccessTokenPrefix) !== null;
}
