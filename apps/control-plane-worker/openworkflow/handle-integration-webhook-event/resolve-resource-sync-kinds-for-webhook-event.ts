import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

export async function resolveResourceSyncKindsForWebhookEvent(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  targetKey: string;
  eventType: string;
}): Promise<ReadonlyArray<string>> {
  const target = await input.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, input.targetKey),
  });
  if (target === undefined) {
    throw new Error(`Integration target '${input.targetKey}' was not found.`);
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  const matchedTrigger = definition.resourceSyncTriggers?.find(
    (trigger) => trigger.eventType === input.eventType,
  );

  return matchedTrigger?.resourceKinds ?? [];
}
