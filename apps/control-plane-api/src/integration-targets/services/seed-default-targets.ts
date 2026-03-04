import { integrationTargets, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  buildDefaultSeedIntegrationTargets,
  type IntegrationsTargetCatalogConfig,
  type SeedIntegrationTarget,
} from "@mistle/integrations-definitions";
import { sql } from "drizzle-orm";

async function upsertIntegrationTarget(
  db: ControlPlaneDatabase,
  target: SeedIntegrationTarget,
): Promise<void> {
  await db
    .insert(integrationTargets)
    .values(target)
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: target.config,
        updatedAt: sql`now()`,
      },
    });
}

export async function seedDefaultIntegrationTargets(
  db: ControlPlaneDatabase,
  targetCatalog: IntegrationsTargetCatalogConfig | undefined,
): Promise<Array<{ targetKey: string; enabled: boolean }>> {
  const targets = buildDefaultSeedIntegrationTargets(targetCatalog);

  for (const target of targets) {
    await upsertIntegrationTarget(db, target);
  }

  return targets.map((target) => ({
    targetKey: target.targetKey,
    enabled: target.enabled,
  }));
}

export const SeedDefaultIntegrationTargetsForTests = {
  buildSeedIntegrationTargets: buildDefaultSeedIntegrationTargets,
};
