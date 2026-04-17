import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

export type IdentityLinkProviderMetadata = {
  providerFamily: string;
  eligibleTargetKeys: string[];
  familyId: string;
  variantId: string;
  displayName: string;
  logoKey: string;
  eligibleConnectionMethodIds: string[];
  connectionMethods: Array<{
    id: string;
    label: string;
  }>;
};

export async function listIdentityLinkProviderMetadata(ctx: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
}): Promise<ReadonlyArray<IdentityLinkProviderMetadata>> {
  const targets = await ctx.db.query.integrationTargets.findMany({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.enabled, true),
    orderBy: (table, { asc }) => [asc(table.familyId), asc(table.targetKey)],
  });

  const providersByFamily = new Map<string, IdentityLinkProviderMetadata>();

  for (const target of targets) {
    const definition = ctx.integrationRegistry.getDefinition({
      familyId: target.familyId,
      variantId: target.variantId,
    });

    if (definition?.identityLinking === undefined) {
      continue;
    }

    const existingProvider = providersByFamily.get(target.familyId);
    if (existingProvider !== undefined) {
      if (existingProvider.variantId !== target.variantId) {
        throw new Error(
          `Multiple identity-linking integration variants are enabled for provider family '${target.familyId}'.`,
        );
      }

      existingProvider.eligibleTargetKeys.push(target.targetKey);
      continue;
    }

    providersByFamily.set(target.familyId, {
      providerFamily: target.familyId,
      eligibleTargetKeys: [target.targetKey],
      familyId: target.familyId,
      variantId: target.variantId,
      displayName: definition.displayName,
      logoKey: definition.logoKey,
      eligibleConnectionMethodIds: [...definition.identityLinking.eligibleConnectionMethodIds],
      connectionMethods: definition.connectionMethods.map((method) => ({
        id: method.id,
        label: method.label,
      })),
    });
  }

  return [...providersByFamily.values()]
    .map((provider) => ({
      ...provider,
      eligibleTargetKeys: provider.eligibleTargetKeys.sort((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
