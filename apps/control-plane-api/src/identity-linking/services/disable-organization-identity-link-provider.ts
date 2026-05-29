import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";

import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import {
  resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow,
  resolveIdentityLinkProviderMetadataOrThrow,
  resolveOrganizationIdentityLinkProviderConfigByIdOrThrow,
} from "./resolve-organization-identity-link-provider-config.js";
import { syncProfileGitCommitSigningForIdentityLinking } from "./sync-profile-git-commit-signing.js";

export async function disableOrganizationIdentityLinkProvider(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
  },
) {
  await resolveIdentityLinkProviderMetadataOrThrow(ctx, {
    providerFamily: input.providerFamily,
  });
  const existingConfig =
    await resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow(
      {
        db: ctx.db,
      },
      {
        organizationId: input.organizationId,
        providerFamily: input.providerFamily,
      },
    );

  await disableOrganizationIdentityLinkProviderConfig(ctx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    organizationProviderConfigId: existingConfig.id,
  });

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after disable.`,
    );
  }

  return configuredProvider;
}

export async function disableOrganizationIdentityLinkProviderConfig(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    organizationProviderConfigId: string;
  },
) {
  return await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const existingConfig = await resolveOrganizationIdentityLinkProviderConfigByIdOrThrow(
      {
        db: tx,
      },
      {
        organizationId: input.organizationId,
        organizationProviderConfigId: input.organizationProviderConfigId,
      },
    );

    const [config] = await tx
      .update(tables.organizationIdentityLinkProviderConfigs)
      .set({
        status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
        updatedByUserId: input.actorUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.organizationIdentityLinkProviderConfigs.id, existingConfig.id))
      .returning({
        id: tables.organizationIdentityLinkProviderConfigs.id,
        providerFamily: tables.organizationIdentityLinkProviderConfigs.providerFamily,
        status: tables.organizationIdentityLinkProviderConfigs.status,
        integrationTargetKey: tables.organizationIdentityLinkProviderConfigs.integrationTargetKey,
        integrationConnectionId:
          tables.organizationIdentityLinkProviderConfigs.integrationConnectionId,
      });

    if (config === undefined) {
      throw new Error(`Failed to disable identity-link provider config '${existingConfig.id}'.`);
    }

    if (existingConfig.status !== OrganizationIdentityLinkProviderConfigStatus.DISABLED) {
      await syncProfileGitCommitSigningForIdentityLinking(tx, {
        organizationId: input.organizationId,
        providerFamily: config.providerFamily,
        integrationConnectionId: config.integrationConnectionId,
        action: "disable",
      });
    }

    return config;
  });
}
