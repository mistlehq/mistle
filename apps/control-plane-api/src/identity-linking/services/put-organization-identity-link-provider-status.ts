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
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";

export async function putOrganizationIdentityLinkProviderStatus(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
    status:
      | typeof OrganizationIdentityLinkProviderConfigStatus.ACTIVE
      | typeof OrganizationIdentityLinkProviderConfigStatus.DISABLED;
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

  await putOrganizationIdentityLinkProviderConfigStatus(ctx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    organizationProviderConfigId: existingConfig.id,
    status: input.status,
  });

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after status update.`,
    );
  }

  return configuredProvider;
}

export async function putOrganizationIdentityLinkProviderConfigStatus(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    organizationProviderConfigId: string;
    status:
      | typeof OrganizationIdentityLinkProviderConfigStatus.ACTIVE
      | typeof OrganizationIdentityLinkProviderConfigStatus.DISABLED;
  },
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const existingConfig = await resolveOrganizationIdentityLinkProviderConfigByIdOrThrow(
    {
      db: ctx.db,
    },
    {
      organizationId: input.organizationId,
      organizationProviderConfigId: input.organizationProviderConfigId,
    },
  );
  const provider = await resolveIdentityLinkProviderMetadataOrThrow(ctx, {
    providerFamily: existingConfig.providerFamily,
  });

  if (input.status === OrganizationIdentityLinkProviderConfigStatus.ACTIVE) {
    await resolveValidatedProviderConnectionOrThrow(
      {
        db: ctx.db,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        organizationId: input.organizationId,
        integrationConnectionId: existingConfig.integrationConnectionId,
        provider,
      },
    );
  }

  const [config] = await ctx.db
    .update(tables.organizationIdentityLinkProviderConfigs)
    .set({
      status: input.status,
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
    throw new Error(`Failed to update identity-link provider config '${existingConfig.id}'.`);
  }

  return config;
}
