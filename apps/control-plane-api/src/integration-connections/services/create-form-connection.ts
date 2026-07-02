import {
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  IntegrationConnectionStatuses,
  type IntegrationTarget,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type {
  AnyIntegrationDefinition,
  IntegrationConnectionMethodId,
  IntegrationFormConnectionMethodPostCreateMetadata,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import type { CreatedFormIntegrationConnection, ManagedWebhookSetupResult } from "../schemas.js";
import { buildIntegrationConnectionResponse } from "./build-integration-connection-response.js";
import {
  buildFormConnectionConfigForMethodOrThrow,
  buildFormConnectionMethodContextOrThrow,
  type ParsedFormSecret,
  parseFormConnectionConfigOrThrow,
  parseCreateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "./form-connection-methods.js";
import {
  createIntegrationWebhookSource,
  ensureImplicitConnectionWebhookSource,
} from "./webhook-sources.js";

export type CreateFormConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
  methodId: IntegrationConnectionMethodId;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export function shouldAutoCreateManagedWebhookSource(
  postCreate: IntegrationFormConnectionMethodPostCreateMetadata | undefined,
): boolean {
  return postCreate?.managedWebhookSource?.autoCreate === true;
}

export function shouldReturnPartialManagedWebhookSetupFailure(
  error: unknown,
): error is BadRequestError {
  return (
    error instanceof BadRequestError &&
    error.code === IntegrationConnectionsBadRequestCodes.INVALID_WEBHOOK_SOURCE_INPUT
  );
}

async function tryCreateManagedWebhookSource(
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
): Promise<ManagedWebhookSetupResult> {
  try {
    const createdSource = await createIntegrationWebhookSource(ctx, {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
    });

    return {
      status: "created",
      webhookSourceId: createdSource.id,
    };
  } catch (error) {
    if (!shouldReturnPartialManagedWebhookSetupFailure(error)) {
      throw error;
    }

    return {
      status: "failed",
      message: error.message,
    };
  }
}

function buildCreateValidationSecrets(
  parsedSecrets: readonly ParsedFormSecret[],
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const parsedSecret of parsedSecrets) {
    secrets[parsedSecret.field.name] = parsedSecret.normalizedValue;
  }
  return secrets;
}

async function validateFormConnectionCreateOrThrow(
  ctx: {
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    targetKey: string;
    definition: AnyIntegrationDefinition;
    target: IntegrationTarget;
    formMethod: Extract<AnyIntegrationDefinition["connectionMethods"][number], { kind: "form" }>;
    parsedConfig: Record<string, unknown>;
    parsedSecrets: readonly ParsedFormSecret[];
  },
): Promise<void> {
  const validateCreate = input.formMethod.validateCreate?.bind(input.formMethod);
  if (validateCreate === undefined) {
    return;
  }

  try {
    await validateCreate({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      target: {
        familyId: input.target.familyId,
        variantId: input.target.variantId,
        enabled: input.target.enabled,
        config: input.definition.targetConfigSchema.parse(input.target.config),
        secrets: input.definition.targetSecretSchema.parse(
          resolveIntegrationTargetSecrets({
            integrationsConfig: ctx.integrationsConfig,
            target: input.target,
          }),
        ),
      },
      config: input.parsedConfig,
      secrets: buildCreateValidationSecrets(input.parsedSecrets),
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      error instanceof Error ? error.message : "Integration connection validation failed.",
    );
  }
}

export async function createFormConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: CreateFormConnectionInput,
): Promise<CreatedFormIntegrationConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;
  const tables = getControlPlaneDatabaseSchema(db);

  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: input.targetKey,
    methodId: input.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  const configWithConnectionMethod = buildFormConnectionConfigForMethodOrThrow({
    targetKey: input.targetKey,
    methodId: input.methodId,
    config: input.config,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  const parsedConfig = parseFormConnectionConfigOrThrow({
    targetKey: input.targetKey,
    method: formMethod,
    config: configWithConnectionMethod,
    formContext: buildFormConnectionMethodContextOrThrow({
      targetKey: input.targetKey,
      target,
      currentValue: configWithConnectionMethod,
      definition,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
    }),
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  const parsedSecrets = parseCreateFormSecretsOrThrow({
    method: formMethod,
    secrets: input.secrets,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
  });
  await validateFormConnectionCreateOrThrow(
    {
      integrationsConfig,
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
    },
    {
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      definition,
      target,
      formMethod,
      parsedConfig,
      parsedSecrets,
    },
  );

  const organizationCredentialKey = await db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
  });

  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const createdConnection = await db.transaction(async (tx) => {
      const [createdConnection] = await tx
        .insert(tables.integrationConnections)
        .values({
          organizationId: input.organizationId,
          targetKey: input.targetKey,
          displayName: input.displayName,
          status: IntegrationConnectionStatuses.ACTIVE,
          config: parsedConfig,
          targetSnapshotConfig: target.config,
        })
        .returning();

      if (createdConnection === undefined) {
        throw new Error("Failed to create integration connection.");
      }

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(tables.integrationCredentials)
          .values({
            organizationId: input.organizationId,
            secretKind: parsedSecret.persistedSecretRef.secretKind,
            ciphertext: encryptedSecret.ciphertext,
            nonce: encryptedSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: target.familyId,
          })
          .returning({
            id: tables.integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create integration credential.");
        }

        await tx.insert(tables.integrationConnectionCredentials).values({
          connectionId: createdConnection.id,
          credentialId: createdCredential.id,
          slotKey: parsedSecret.persistedSecretRef.slotKey,
        });
      }

      const webhookSourceCapability = definition.webhookSource;
      if (
        webhookSourceCapability?.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
        ((await webhookSourceCapability.supportsConnection?.({
          connection: {
            id: createdConnection.id,
            status: createdConnection.status,
            config: parsedConfig,
          },
        })) ??
          true)
      ) {
        await ensureImplicitConnectionWebhookSource({
          db: tx,
          organizationId: input.organizationId,
          connectionId: createdConnection.id,
          targetKey: input.targetKey,
          providerMetadata: webhookSourceCapability.initialSourceProviderMetadata,
        });
      }

      return buildIntegrationConnectionResponse({
        connection: createdConnection,
      });
    });

    if (shouldAutoCreateManagedWebhookSource(formMethod.postCreate)) {
      return {
        ...createdConnection,
        managedWebhookSetup: await tryCreateManagedWebhookSource(ctx, {
          organizationId: input.organizationId,
          connectionId: createdConnection.id,
        }),
      };
    }

    return createdConnection;
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
