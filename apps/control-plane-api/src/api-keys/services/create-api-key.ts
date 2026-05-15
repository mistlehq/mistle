import type { ApiKeyActorKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";

import type { OrganizationPermission } from "../../auth/services/organization-policy.js";
import { projectApiKey, type ApiKeyResponse } from "./api-key-projection.js";
import { generateApiKeySecret } from "./api-key-secret.js";

export type CreateApiKeyInput = {
  organizationId: string;
  actorKind: ApiKeyActorKind;
  actorId: string;
  name: string;
  permissions: readonly OrganizationPermission[];
  expiresAt?: string | undefined;
};

export type CreateApiKeyResult = {
  apiKey: ApiKeyResponse;
  token: string;
};

export async function createApiKey(
  ctx: { db: ControlPlaneDatabase },
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  const secret = generateApiKeySecret();

  return await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const [createdApiKey] = await tx
      .insert(tables.apiKeys)
      .values({
        organizationId: input.organizationId,
        name: input.name,
        secretPrefix: secret.secretPrefix,
        secretHash: secret.secretHash,
        secretHashAlgorithm: secret.secretHashAlgorithm,
        createdByActorKind: input.actorKind,
        createdByActorId: input.actorId,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      })
      .returning();

    if (createdApiKey === undefined) {
      throw new Error("Failed to create API key.");
    }

    if (input.permissions.length > 0) {
      await tx.insert(tables.apiKeyPermissions).values(
        input.permissions.map((permission) => ({
          apiKeyId: createdApiKey.id,
          permission,
        })),
      );
    }

    return {
      apiKey: projectApiKey({
        apiKey: createdApiKey,
        permissions: input.permissions,
      }),
      token: secret.token,
    };
  });
}
