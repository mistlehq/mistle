import { integrationTargets, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

type SyncIntegrationTarget = {
  targetKey: string;
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

function buildSyncIntegrationTargets(
  integrationRegistry: IntegrationRegistry,
): SyncIntegrationTarget[] {
  const targetKeys = new Set<string>();

  return integrationRegistry.listDefinitions().map((definition) => {
    const targetKey = definition.variantId;

    if (targetKeys.has(targetKey)) {
      throw new Error(
        `Integration definition variantId '${targetKey}' is duplicated and cannot be used as targetKey.`,
      );
    }
    targetKeys.add(targetKey);

    return {
      targetKey,
      familyId: definition.familyId,
      variantId: definition.variantId,
      enabled: false,
      config: {},
    };
  });
}

async function upsertIntegrationTarget(
  db: ControlPlaneDatabase,
  target: SyncIntegrationTarget,
): Promise<void> {
  await db
    .insert(integrationTargets)
    .values(target)
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: target.familyId,
        variantId: target.variantId,
        updatedAt: sql`now()`,
      },
    });
}

export async function syncIntegrationTargets(
  db: ControlPlaneDatabase,
  integrationRegistry: IntegrationRegistry,
): Promise<Array<{ targetKey: string; enabled: boolean }>> {
  const targets = buildSyncIntegrationTargets(integrationRegistry);

  for (const target of targets) {
    await upsertIntegrationTarget(db, target);
  }

  return targets.map((target) => ({
    targetKey: target.targetKey,
    enabled: target.enabled,
  }));
}

export const SyncIntegrationTargetsForTests = {
  buildSyncIntegrationTargets,
};
