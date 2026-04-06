import {
  integrationWebhookSources,
  IntegrationWebhookSourceOwnerScopes,
  IntegrationWebhookSourceStatuses,
  type ControlPlaneDatabase,
  type IntegrationWebhookSource,
} from "@mistle/db/control-plane";

export async function ensureImplicitTargetWebhookSource(input: {
  db: ControlPlaneDatabase;
  targetKey: string;
  routingStrategy: "payload" | "path";
}): Promise<IntegrationWebhookSource> {
  const existingSource = await input.db.query.integrationWebhookSources.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.targetKey, input.targetKey),
        whereEq(table.ownerScope, IntegrationWebhookSourceOwnerScopes.TARGET),
        whereEq(table.status, IntegrationWebhookSourceStatuses.ACTIVE),
      ),
  });

  if (existingSource !== undefined) {
    return existingSource;
  }

  const [createdSource] = await input.db
    .insert(integrationWebhookSources)
    .values({
      ownerScope: IntegrationWebhookSourceOwnerScopes.TARGET,
      targetKey: input.targetKey,
      routingStrategy: input.routingStrategy,
      status: IntegrationWebhookSourceStatuses.ACTIVE,
    })
    .returning();

  if (createdSource === undefined) {
    throw new Error(`Failed to create implicit webhook source for '${input.targetKey}'.`);
  }

  return createdSource;
}
