import { timingSafeEqual } from "node:crypto";

import { getControlPlaneDatabaseSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { UnauthorizedError } from "@mistle/http/errors.js";
import { eq, sql } from "drizzle-orm";

import {
  ApiKeySecretHashAlgorithms,
  ApiKeySecretPrefixLength,
  hashApiKeyToken,
} from "../../api-keys/services/api-key-secret.js";
import { parseApiKeyPermissions } from "../../api-keys/services/permissions.js";
import type { AppAuthContext } from "../../types.js";

const ApiKeyTokenPrefix = "mstl_apk_";

export async function authenticateApiKeyToken(input: {
  db: ControlPlaneDatabase;
  token: string;
}): Promise<Extract<AppAuthContext, { kind: "api_key" }>> {
  const secretPrefix = parseApiKeySecretPrefix(input.token);
  if (secretPrefix === null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const apiKey = await input.db.query.apiKeys.findFirst({
    columns: {
      id: true,
      name: true,
      organizationId: true,
      secretHash: true,
      secretHashAlgorithm: true,
      revokedAt: true,
      expiresAt: true,
    },
    where: (table, { eq }) => eq(table.secretPrefix, secretPrefix),
  });

  if (apiKey === undefined) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  if (apiKey.revokedAt !== null) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  if (apiKey.expiresAt !== null && new Date(apiKey.expiresAt) <= new Date()) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  if (apiKey.secretHashAlgorithm !== ApiKeySecretHashAlgorithms.SHA256_V1) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  if (!secureEqual(hashApiKeyToken(input.token), apiKey.secretHash)) {
    throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
  }

  const permissions = await input.db.query.apiKeyPermissions.findMany({
    columns: {
      permission: true,
    },
    where: (table, { eq }) => eq(table.apiKeyId, apiKey.id),
  });

  const tables = getControlPlaneDatabaseSchema(input.db);
  await input.db
    .update(tables.apiKeys)
    .set({
      lastUsedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.apiKeys.id, apiKey.id));

  return {
    kind: "api_key",
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      organizationId: apiKey.organizationId,
    },
    permissions: parseApiKeyPermissions(permissions.map((permission) => permission.permission)),
  };
}

export function parseBearerToken(authorization: string | null): string | null {
  if (authorization === null) {
    return null;
  }

  const [scheme, token, unexpected] = authorization.trim().split(/\s+/u);
  if (scheme !== "Bearer" || token === undefined || unexpected !== undefined) {
    return null;
  }

  return token;
}

function parseApiKeySecretPrefix(token: string): string | null {
  if (!token.startsWith(ApiKeyTokenPrefix)) {
    return null;
  }

  const secretPrefixStart = ApiKeyTokenPrefix.length;
  const secretPrefixEnd = secretPrefixStart + ApiKeySecretPrefixLength;
  if (token.length <= secretPrefixEnd) {
    return null;
  }

  if (token[secretPrefixEnd] !== "_") {
    return null;
  }

  if (token.length === secretPrefixEnd + 1) {
    return null;
  }

  return token.slice(secretPrefixStart, secretPrefixEnd);
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
