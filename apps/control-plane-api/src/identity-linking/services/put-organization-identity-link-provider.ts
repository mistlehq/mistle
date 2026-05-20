import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import {
  resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow,
  resolveIdentityLinkProviderMetadataOrThrow,
  resolveOrganizationIdentityLinkProviderConfigByIdOrThrow,
} from "./resolve-organization-identity-link-provider-config.js";
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";

export async function putOrganizationIdentityLinkProvider(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
    integrationConnectionId: string;
  },
) {
  const existingConfigs = await ctx.db.query.organizationIdentityLinkProviderConfigs.findMany({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
      ),
    limit: 2,
  });

  if (existingConfigs.length === 0) {
    await createOrganizationIdentityLinkProviderConfig(ctx, {
      ...input,
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
    });
  } else {
    const existingConfig =
      await resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow(ctx, {
        organizationId: input.organizationId,
        providerFamily: input.providerFamily,
      });
    await updateOrganizationIdentityLinkProviderConfigConnection(ctx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      organizationProviderConfigId: existingConfig.id,
      integrationConnectionId: input.integrationConnectionId,
    });
  }

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after upsert.`,
    );
  }

  return configuredProvider;
}

export async function createOrganizationIdentityLinkProviderConfig(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
    integrationConnectionId: string;
    status: OrganizationIdentityLinkProviderConfigStatus;
  },
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const provider = await resolveIdentityLinkProviderMetadataOrThrow(ctx, {
    providerFamily: input.providerFamily,
  });

  const connection = await resolveValidatedProviderConnectionOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
    },
    {
      organizationId: input.organizationId,
      integrationConnectionId: input.integrationConnectionId,
      provider,
    },
  );

  const [config] = await ctx.db
    .insert(tables.organizationIdentityLinkProviderConfigs)
    .values({
      organizationId: input.organizationId,
      providerFamily: provider.providerFamily,
      status: input.status,
      integrationTargetKey: connection.targetKey,
      integrationConnectionId: input.integrationConnectionId,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
    })
    .returning({
      id: tables.organizationIdentityLinkProviderConfigs.id,
      providerFamily: tables.organizationIdentityLinkProviderConfigs.providerFamily,
      status: tables.organizationIdentityLinkProviderConfigs.status,
      integrationTargetKey: tables.organizationIdentityLinkProviderConfigs.integrationTargetKey,
      integrationConnectionId:
        tables.organizationIdentityLinkProviderConfigs.integrationConnectionId,
    });

  if (config === undefined) {
    throw new Error("Failed to create identity-link provider config.");
  }

  return config;
}

export async function updateOrganizationIdentityLinkProviderConfigConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    organizationProviderConfigId: string;
    integrationConnectionId: string;
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
  const connection = await resolveValidatedProviderConnectionOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
    },
    {
      organizationId: input.organizationId,
      integrationConnectionId: input.integrationConnectionId,
      provider,
    },
  );

  const [config] = await ctx.db
    .update(tables.organizationIdentityLinkProviderConfigs)
    .set({
      integrationTargetKey: connection.targetKey,
      integrationConnectionId: input.integrationConnectionId,
      updatedByUserId: input.actorUserId,
      updatedAt: sql`now()`,
    })
    .where(sql`${tables.organizationIdentityLinkProviderConfigs.id} = ${existingConfig.id}`)
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
