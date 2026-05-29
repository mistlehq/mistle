import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { GitHubProviderFamily } from "../github-signing.js";
import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import {
  resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow,
  resolveIdentityLinkProviderMetadataOrThrow,
  resolveOrganizationIdentityLinkProviderConfigByIdOrThrow,
} from "./resolve-organization-identity-link-provider-config.js";
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";
import { syncProfileGitCommitSigningForIdentityLinking } from "./sync-profile-git-commit-signing.js";

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
  return await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const provider = await resolveIdentityLinkProviderMetadataOrThrow(
      {
        db: tx,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        providerFamily: input.providerFamily,
      },
    );

    const connection = await resolveValidatedProviderConnectionOrThrow(
      {
        db: tx,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        organizationId: input.organizationId,
        integrationConnectionId: input.integrationConnectionId,
        provider,
      },
    );
    await assertGitHubIdentityLinkingConnectionIsNotConfigured(tx, {
      organizationId: input.organizationId,
      providerFamily: provider.providerFamily,
      integrationConnectionId: input.integrationConnectionId,
      organizationProviderConfigId: null,
    });

    const [config] = await tx
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

    if (input.status === OrganizationIdentityLinkProviderConfigStatus.ACTIVE) {
      await syncProfileGitCommitSigningForIdentityLinking(tx, {
        organizationId: input.organizationId,
        providerFamily: config.providerFamily,
        integrationConnectionId: config.integrationConnectionId,
        action: "enable",
      });
    }

    return config;
  });
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
    const provider = await resolveIdentityLinkProviderMetadataOrThrow(
      {
        db: tx,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        providerFamily: existingConfig.providerFamily,
      },
    );
    const connection = await resolveValidatedProviderConnectionOrThrow(
      {
        db: tx,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        organizationId: input.organizationId,
        integrationConnectionId: input.integrationConnectionId,
        provider,
      },
    );
    await assertGitHubIdentityLinkingConnectionIsNotConfigured(tx, {
      organizationId: input.organizationId,
      providerFamily: provider.providerFamily,
      integrationConnectionId: input.integrationConnectionId,
      organizationProviderConfigId: existingConfig.id,
    });

    const [config] = await tx
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

    if (
      existingConfig.status === OrganizationIdentityLinkProviderConfigStatus.ACTIVE &&
      existingConfig.integrationConnectionId !== config.integrationConnectionId
    ) {
      await syncProfileGitCommitSigningForIdentityLinking(tx, {
        organizationId: input.organizationId,
        providerFamily: config.providerFamily,
        integrationConnectionId: existingConfig.integrationConnectionId,
        action: "disable",
      });
      await syncProfileGitCommitSigningForIdentityLinking(tx, {
        organizationId: input.organizationId,
        providerFamily: config.providerFamily,
        integrationConnectionId: config.integrationConnectionId,
        action: "enable",
      });
    }

    return config;
  });
}

async function assertGitHubIdentityLinkingConnectionIsNotConfigured(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    organizationProviderConfigId: string | null;
  },
): Promise<void> {
  if (input.providerFamily !== GitHubProviderFamily) {
    return;
  }

  const existingConfig = await db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
        eq(table.integrationConnectionId, input.integrationConnectionId),
      ),
  });

  if (existingConfig === undefined || existingConfig.id === input.organizationProviderConfigId) {
    return;
  }

  throw new BadRequestError(
    IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
    `GitHub identity-linking connection '${input.integrationConnectionId}' is already configured.`,
  );
}
