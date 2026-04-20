import { randomBytes } from "node:crypto";

import {
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationWebhookSources,
  IntegrationWebhookSourceStatuses,
  type ControlPlaneDatabase,
  type IntegrationWebhookSource,
} from "@mistle/db/control-plane";
import { BadRequestError, ConflictError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationWebhookSourceLifecycles,
  type AnyIntegrationDefinition,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { eq } from "drizzle-orm";

import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../../internal/integration-credentials/services/errors.js";
import { resolveIntegrationCredential } from "../../internal/integration-credentials/services/resolve-credential.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

type WebhookSourceListItem = {
  id: string;
  targetKey: string;
  integrationConnectionId: string;
  displayName: string;
  endpointKey: string;
  callbackUrl?: string;
  remoteRegistrationId?: string;
  status: "active" | "error" | "disabled";
  providerMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type CreatedWebhookSource = WebhookSourceListItem & {
  webhookSecret?: string;
};

type ConnectionWithTarget = {
  id: string;
  organizationId: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  config: Record<string, unknown> | null;
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    secrets: {
      ciphertext: string;
      nonce: string;
      masterKeyVersion: number;
    } | null;
  };
};

function resolveStringCredentialValueOrThrow(input: {
  credential: Awaited<ReturnType<typeof resolveIntegrationCredential>>;
  context: string;
}): string {
  if (input.credential.kind !== "value") {
    throw new Error(`${input.context} requires a string credential value.`);
  }

  return input.credential.value;
}

function generateEndpointKey(): string {
  return randomBytes(16).toString("base64url");
}

function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function resolveConnectionConfigOrThrow(input: {
  connectionId: string;
  config: Record<string, unknown> | null;
}): Record<string, unknown> {
  if (input.config === null) {
    throw new Error(`Integration connection '${input.connectionId}' is missing config.`);
  }

  return input.config;
}

export async function resolveConnectionWithTargetOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
}): Promise<ConnectionWithTarget> {
  const connection = await input.db.query.integrationConnections.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.connectionId),
        whereEq(table.organizationId, input.organizationId),
      ),
    with: {
      target: true,
    },
  });

  if (connection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  if (connection.target === null) {
    throw new Error(`Integration connection '${input.connectionId}' is missing target.`);
  }

  return {
    id: connection.id,
    organizationId: connection.organizationId,
    targetKey: connection.targetKey,
    displayName: connection.displayName,
    status: connection.status,
    config: connection.config,
    target: connection.target,
  };
}

function resolveConnectionMethodIdOrThrow(input: {
  connectionId: string;
  config: Record<string, unknown>;
}): string {
  const connectionMethodId = input.config["connection_method"];
  if (typeof connectionMethodId !== "string" || connectionMethodId.length === 0) {
    throw new Error(
      `Integration connection '${input.connectionId}' is missing a valid connection_method.`,
    );
  }

  return connectionMethodId;
}

export async function resolveConnectionSecretsOrThrow(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  connection: ConnectionWithTarget;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<Record<string, string>> {
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: input.connection.id,
    config: input.connection.config,
  });
  const definition = input.integrationRegistry.getDefinition({
    familyId: input.connection.target.familyId,
    variantId: input.connection.target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${input.connection.target.familyId}/${input.connection.target.variantId}' is not registered.`,
    );
  }

  const connectionMethodId = resolveConnectionMethodIdOrThrow({
    connectionId: input.connection.id,
    config: connectionConfig,
  });
  const connectionMethod = definition.connectionMethods.find(
    (method) => method.id === connectionMethodId,
  );
  if (connectionMethod === undefined) {
    throw new Error(
      `Integration connection '${input.connection.id}' references unknown method '${connectionMethodId}'.`,
    );
  }

  if (connectionMethod.kind !== "form") {
    return {};
  }

  const resolvedFieldSecrets = await Promise.all(
    connectionMethod.secretFields.map(async (field) => {
      let resolvedCredential;
      try {
        resolvedCredential = await resolveIntegrationCredential(
          {
            db: input.db,
            integrationRegistry: input.integrationRegistry,
            integrationsConfig: input.integrationsConfig,
          },
          {
            connectionId: input.connection.id,
            secretType: field.secretType,
            slotKey: field.slotKey,
          },
        );
      } catch (error) {
        if (
          field.optional &&
          error instanceof InternalIntegrationCredentialsError &&
          error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
        ) {
          return undefined;
        }

        throw error;
      }

      return [
        field.name,
        resolveStringCredentialValueOrThrow({
          credential: resolvedCredential,
          context: "Webhook source connection secret hydration",
        }),
      ] as const;
    }),
  );

  return Object.fromEntries(
    resolvedFieldSecrets.filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
}

export function resolveWebhookSourceCapabilityOrThrow(input: {
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  target: ConnectionWithTarget["target"];
}) {
  const definition = input.integrationRegistry.getDefinition({
    familyId: input.target.familyId,
    variantId: input.target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${input.target.familyId}/${input.target.variantId}' is not registered.`,
    );
  }

  if (definition.webhookSource === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      `Integration target '${input.target.targetKey}' does not support webhook sources.`,
    );
  }

  const parsedTargetConfig = definition.targetConfigSchema.parse(input.target.config);
  const parsedTargetSecrets = definition.targetSecretSchema.parse(
    resolveIntegrationTargetSecrets({
      integrationsConfig: input.integrationsConfig,
      target: input.target,
    }),
  );

  return {
    definition,
    webhookSourceCapability: definition.webhookSource,
    parsedTargetConfig,
    parsedTargetSecrets,
  };
}

async function supportsWebhookSourceForConnection(input: {
  webhookSourceCapability: NonNullable<AnyIntegrationDefinition["webhookSource"]>;
  connection: ConnectionWithTarget;
}): Promise<boolean> {
  if (input.webhookSourceCapability.supportsConnection === undefined) {
    return true;
  }

  return input.webhookSourceCapability.supportsConnection({
    connection: {
      id: input.connection.id,
      status: input.connection.status,
      config: resolveConnectionConfigOrThrow({
        connectionId: input.connection.id,
        config: input.connection.config,
      }),
    },
  });
}

export async function ensureImplicitConnectionWebhookSource(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
  targetKey: string;
}): Promise<IntegrationWebhookSource> {
  const existingSource = await input.db.query.integrationWebhookSources.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.integrationConnectionId, input.connectionId),
        whereEq(table.targetKey, input.targetKey),
        whereEq(table.status, IntegrationWebhookSourceStatuses.ACTIVE),
      ),
  });

  if (existingSource !== undefined) {
    return existingSource;
  }

  const endpointKey = generateEndpointKey();

  const [createdSource] = await input.db
    .insert(integrationWebhookSources)
    .values({
      organizationId: input.organizationId,
      integrationConnectionId: input.connectionId,
      targetKey: input.targetKey,
      endpointKey,
      status: IntegrationWebhookSourceStatuses.ACTIVE,
    })
    .returning();

  if (createdSource === undefined) {
    throw new Error(
      `Failed to create implicit webhook source for connection '${input.connectionId}'.`,
    );
  }

  return createdSource;
}
function toWebhookSourceListItem(input: {
  source: IntegrationWebhookSource;
  descriptor: {
    displayName: string;
    callbackUrl?: string | undefined;
    providerMetadata: Record<string, unknown>;
  };
}): WebhookSourceListItem {
  return {
    id: input.source.id,
    targetKey: input.source.targetKey,
    integrationConnectionId: input.source.integrationConnectionId,
    displayName: input.descriptor.displayName,
    endpointKey: input.source.endpointKey,
    ...(input.descriptor.callbackUrl === undefined
      ? {}
      : { callbackUrl: input.descriptor.callbackUrl }),
    ...(input.source.remoteRegistrationId === null ||
    input.source.remoteRegistrationId === undefined
      ? {}
      : { remoteRegistrationId: input.source.remoteRegistrationId }),
    status: input.source.status,
    providerMetadata: input.descriptor.providerMetadata,
    createdAt: input.source.createdAt,
    updatedAt: input.source.updatedAt,
  };
}

async function resolveWebhookSourceDescriptor(input: {
  controlPlaneBaseUrl: string;
  webhookSourceCapability: NonNullable<AnyIntegrationDefinition["webhookSource"]>;
  parsedTargetConfig: unknown;
  parsedTargetSecrets: unknown;
  connection: ConnectionWithTarget;
  source: IntegrationWebhookSource;
}) {
  const descriptor = await input.webhookSourceCapability.describeSource({
    organizationId: input.connection.organizationId,
    targetKey: input.connection.targetKey,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    target: {
      familyId: input.connection.target.familyId,
      variantId: input.connection.target.variantId,
      enabled: input.connection.target.enabled,
      config: input.parsedTargetConfig,
      secrets: input.parsedTargetSecrets,
    },
    connection: {
      id: input.connection.id,
      status: "active",
      config: resolveConnectionConfigOrThrow({
        connectionId: input.connection.id,
        config: input.connection.config,
      }),
    },
    source: {
      id: input.source.id,
      targetKey: input.source.targetKey,
      organizationId: input.source.organizationId,
      integrationConnectionId: input.source.integrationConnectionId,
      ...(input.source.displayName === null || input.source.displayName === undefined
        ? {}
        : { displayName: input.source.displayName }),
      endpointKey: input.source.endpointKey,
      ...(input.source.remoteRegistrationId === null ||
      input.source.remoteRegistrationId === undefined
        ? {}
        : { remoteRegistrationId: input.source.remoteRegistrationId }),
      providerMetadata: input.source.providerMetadata,
    },
  });

  return descriptor;
}

async function createWebhookSecretCredential(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  familyId: string;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  webhookSecret: string;
}): Promise<string> {
  const organizationCredentialKey = await input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.webhookSecret,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
    const [createdCredential] = await input.db
      .insert(integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: IntegrationCredentialSecretKinds.WEBHOOK_SECRET,
        ciphertext: encryptedSecret.ciphertext,
        nonce: encryptedSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.familyId,
      })
      .returning({
        id: integrationCredentials.id,
      });

    if (createdCredential === undefined) {
      throw new Error("Failed to create webhook secret credential.");
    }

    return createdCredential.id;
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

async function resolveAccessibleWebhookSourceOrThrow(input: {
  db: ControlPlaneDatabase;
  connection: ConnectionWithTarget;
  webhookSourceId: string;
}): Promise<IntegrationWebhookSource> {
  const source = await input.db.query.integrationWebhookSources.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.webhookSourceId),
  });

  if (source === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Webhook source '${input.webhookSourceId}' was not found.`,
    );
  }

  if (source.targetKey !== input.connection.targetKey) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Webhook source '${input.webhookSourceId}' was not found for connection '${input.connection.id}'.`,
    );
  }

  if (source.integrationConnectionId !== input.connection.id) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Webhook source '${input.webhookSourceId}' was not found for connection '${input.connection.id}'.`,
    );
  }

  return source;
}

export async function listIntegrationWebhookSources(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    connectionId: string;
  },
): Promise<WebhookSourceListItem[]> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition?.webhookSource === undefined) {
    return [];
  }

  const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
    resolveWebhookSourceCapabilityOrThrow({
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      target: connection.target,
    });

  if (
    !(await supportsWebhookSourceForConnection({
      webhookSourceCapability,
      connection,
    }))
  ) {
    return [];
  }

  if (webhookSourceCapability.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT) {
    const source = await ensureImplicitConnectionWebhookSource({
      db: ctx.db,
      organizationId: input.organizationId,
      connectionId: connection.id,
      targetKey: connection.targetKey,
    });
    const descriptor = await resolveWebhookSourceDescriptor({
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      webhookSourceCapability,
      parsedTargetConfig,
      parsedTargetSecrets,
      connection,
      source,
    });

    return [toWebhookSourceListItem({ source, descriptor })];
  }

  const sources = await ctx.db.query.integrationWebhookSources.findMany({
    where: (table, { eq: whereEq }) => whereEq(table.integrationConnectionId, connection.id),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });

  return Promise.all(
    sources.map(async (source) =>
      toWebhookSourceListItem({
        source,
        descriptor: await resolveWebhookSourceDescriptor({
          controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
          webhookSourceCapability,
          parsedTargetConfig,
          parsedTargetSecrets,
          connection,
          source,
        }),
      }),
    ),
  );
}

export async function getIntegrationWebhookSource(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    connectionId: string;
    webhookSourceId: string;
  },
): Promise<WebhookSourceListItem> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
    resolveWebhookSourceCapabilityOrThrow({
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      target: connection.target,
    });
  if (
    !(await supportsWebhookSourceForConnection({
      webhookSourceCapability,
      connection,
    }))
  ) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Webhook source '${input.webhookSourceId}' was not found for connection '${connection.id}'.`,
    );
  }
  const source = await resolveAccessibleWebhookSourceOrThrow({
    db: ctx.db,
    connection,
    webhookSourceId: input.webhookSourceId,
  });
  const descriptor = await resolveWebhookSourceDescriptor({
    controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
    webhookSourceCapability,
    parsedTargetConfig,
    parsedTargetSecrets,
    connection,
    source,
  });

  return toWebhookSourceListItem({ source, descriptor });
}

export async function createIntegrationWebhookSource(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    connectionId: string;
    displayName?: string | undefined;
  },
): Promise<CreatedWebhookSource> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
    resolveWebhookSourceCapabilityOrThrow({
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      target: connection.target,
    });

  if (
    !(await supportsWebhookSourceForConnection({
      webhookSourceCapability,
      connection,
    }))
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      `Integration connection '${connection.id}' does not support webhook sources.`,
    );
  }

  if (webhookSourceCapability.lifecycle !== IntegrationWebhookSourceLifecycles.MANAGED) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_MANAGED_LIFECYCLE_REQUIRED,
      `Integration target '${connection.targetKey}' does not support managed webhook source creation.`,
    );
  }

  const createRegistration =
    webhookSourceCapability.createRegistration?.bind(webhookSourceCapability);
  if (createRegistration === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_NOT_SUPPORTED,
      `Integration target '${connection.targetKey}' does not have webhook source registration configured.`,
    );
  }

  const webhookSecret = generateWebhookSecret();
  const endpointKey = generateEndpointKey();
  const connectionSecrets = await resolveConnectionSecretsOrThrow({
    db: ctx.db,
    integrationRegistry: ctx.integrationRegistry,
    connection,
    integrationsConfig: ctx.integrationsConfig,
  });

  const createdSource = await ctx.db.transaction(async (tx) => {
    const webhookSecretCredentialId = await createWebhookSecretCredential({
      db: tx,
      organizationId: input.organizationId,
      familyId: connection.target.familyId,
      integrationsConfig: ctx.integrationsConfig,
      webhookSecret,
    });

    const [insertedSource] = await tx
      .insert(integrationWebhookSources)
      .values({
        organizationId: input.organizationId,
        integrationConnectionId: connection.id,
        targetKey: connection.targetKey,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        endpointKey,
        webhookSecretCredentialId,
        status: IntegrationWebhookSourceStatuses.ACTIVE,
      })
      .returning();

    if (insertedSource === undefined) {
      throw new Error("Failed to create integration webhook source.");
    }

    let registration;
    try {
      registration = await createRegistration({
        organizationId: input.organizationId,
        targetKey: connection.targetKey,
        controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
        target: {
          familyId: connection.target.familyId,
          variantId: connection.target.variantId,
          enabled: connection.target.enabled,
          config: parsedTargetConfig,
          secrets: parsedTargetSecrets,
        },
        connection: {
          id: connection.id,
          status: "active",
          config: resolveConnectionConfigOrThrow({
            connectionId: connection.id,
            config: connection.config,
          }),
        },
        connectionSecrets,
        source: {
          id: insertedSource.id,
          targetKey: insertedSource.targetKey,
          organizationId: input.organizationId,
          integrationConnectionId: connection.id,
          ...(insertedSource.displayName === null
            ? {}
            : { displayName: insertedSource.displayName }),
          endpointKey: insertedSource.endpointKey,
          providerMetadata: insertedSource.providerMetadata,
        },
        webhookSecret,
      });
    } catch (error) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
        error instanceof Error
          ? error.message
          : `Webhook source registration failed for '${connection.targetKey}'.`,
      );
    }

    const [updatedSource] = await tx
      .update(integrationWebhookSources)
      .set({
        ...(registration.remoteRegistrationId === undefined
          ? {}
          : { remoteRegistrationId: registration.remoteRegistrationId }),
        ...(registration.providerMetadata === undefined
          ? {}
          : { providerMetadata: registration.providerMetadata }),
      })
      .where(eq(integrationWebhookSources.id, insertedSource.id))
      .returning();

    if (updatedSource === undefined) {
      throw new Error("Failed to update integration webhook source registration.");
    }

    return updatedSource;
  });

  const descriptor = await resolveWebhookSourceDescriptor({
    controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
    webhookSourceCapability,
    parsedTargetConfig,
    parsedTargetSecrets,
    connection,
    source: createdSource,
  });

  return {
    ...toWebhookSourceListItem({
      source: createdSource,
      descriptor,
    }),
    webhookSecret,
  };
}

export async function deleteIntegrationWebhookSource(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    connectionId: string;
    webhookSourceId: string;
  },
): Promise<void> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
    resolveWebhookSourceCapabilityOrThrow({
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      target: connection.target,
    });
  if (
    !(await supportsWebhookSourceForConnection({
      webhookSourceCapability,
      connection,
    }))
  ) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.WEBHOOK_SOURCE_NOT_FOUND,
      `Webhook source '${input.webhookSourceId}' was not found for connection '${connection.id}'.`,
    );
  }
  const source = await resolveAccessibleWebhookSourceOrThrow({
    db: ctx.db,
    connection,
    webhookSourceId: input.webhookSourceId,
  });

  if (webhookSourceCapability.lifecycle !== IntegrationWebhookSourceLifecycles.MANAGED) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.WEBHOOK_SOURCE_MANAGED_LIFECYCLE_REQUIRED,
      `Webhook source '${input.webhookSourceId}' is not provider-managed.`,
    );
  }

  const sourceAutomationUsage = await ctx.db.query.webhookAutomations.findFirst({
    columns: {
      automationId: true,
    },
    where: (table, { eq: whereEq }) =>
      whereEq(table.integrationWebhookSourceId, input.webhookSourceId),
  });

  if (sourceAutomationUsage !== undefined) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.WEBHOOK_SOURCE_HAS_AUTOMATIONS,
      "This webhook source cannot be deleted while it is still used by one or more webhook automations.",
    );
  }

  const deleteRegistration =
    webhookSourceCapability.deleteRegistration?.bind(webhookSourceCapability);
  if (deleteRegistration !== undefined) {
    try {
      await deleteRegistration({
        organizationId: input.organizationId,
        targetKey: connection.targetKey,
        controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
        target: {
          familyId: connection.target.familyId,
          variantId: connection.target.variantId,
          enabled: connection.target.enabled,
          config: parsedTargetConfig,
          secrets: parsedTargetSecrets,
        },
        connection: {
          id: connection.id,
          status: "active",
          config: resolveConnectionConfigOrThrow({
            connectionId: connection.id,
            config: connection.config,
          }),
        },
        connectionSecrets: await resolveConnectionSecretsOrThrow({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          connection,
          integrationsConfig: ctx.integrationsConfig,
        }),
        source: {
          id: source.id,
          targetKey: source.targetKey,
          organizationId: source.organizationId,
          integrationConnectionId: source.integrationConnectionId,
          ...(source.displayName === null ? {} : { displayName: source.displayName }),
          endpointKey: source.endpointKey,
          ...(source.remoteRegistrationId === null
            ? {}
            : { remoteRegistrationId: source.remoteRegistrationId }),
          providerMetadata: source.providerMetadata,
        },
      });
    } catch (error) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT,
        error instanceof Error
          ? error.message
          : `Webhook source deletion failed for '${connection.targetKey}'.`,
      );
    }
  }

  await ctx.db.transaction(async (tx) => {
    await tx.delete(integrationWebhookSources).where(eq(integrationWebhookSources.id, source.id));

    if (
      source.webhookSecretCredentialId !== null &&
      source.webhookSecretCredentialId !== undefined
    ) {
      await tx
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.id, source.webhookSecretCredentialId));
    }
  });
}
