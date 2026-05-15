import type { ApiKeyActorKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";

export type DeleteApiKeyInput = {
  organizationId: string;
  apiKeyId: string;
  actorKind: ApiKeyActorKind;
  actorId: string;
};

export async function deleteApiKey(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteApiKeyInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const [updatedApiKey] = await ctx.db
    .update(tables.apiKeys)
    .set({
      revokedAt: sql`now()`,
      revokedByActorKind: input.actorKind,
      revokedByActorId: input.actorId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.apiKeys.id, input.apiKeyId),
        eq(tables.apiKeys.organizationId, input.organizationId),
        isNull(tables.apiKeys.revokedAt),
      ),
    )
    .returning({
      id: tables.apiKeys.id,
    });

  if (updatedApiKey !== undefined) {
    return;
  }

  const existingApiKey = await ctx.db.query.apiKeys.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.apiKeyId), eq(table.organizationId, input.organizationId)),
  });

  if (existingApiKey === undefined) {
    throw new NotFoundError("NOT_FOUND", "API key was not found.");
  }
}
