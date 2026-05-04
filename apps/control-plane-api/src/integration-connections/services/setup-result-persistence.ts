import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type {
  AnyIntegrationDefinition,
  IntegrationProviderAppSetupConnectionUpdate,
} from "@mistle/integrations-core";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import type { ParsedFormSecret } from "./form-connection-methods.js";
import { ensureImplicitConnectionWebhookSource } from "./webhook-sources.js";

type SetupPersistenceConnection = {
  id: string;
  organizationId: string;
  status: string;
  targetKey: string;
  config: Record<string, unknown> | null;
  target: {
    familyId: string;
  };
};

type SetupPersistenceResult = {
  id: string;
  targetKey: string;
};

export async function persistProviderAppSetupResult(input: {
  db: ControlPlaneDatabase;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connection: SetupPersistenceConnection;
  definition: AnyIntegrationDefinition;
  parsedSecrets: ParsedFormSecret[];
  connectionUpdate?: IntegrationProviderAppSetupConnectionUpdate;
  redirectSession?: {
    id: string;
  };
  webhookSourceUpdate?: {
    providerMetadata?: Record<string, unknown>;
  };
}): Promise<SetupPersistenceResult> {
  const organizationCredentialKey =
    input.parsedSecrets.length === 0
      ? undefined
      : await input.db.query.organizationCredentialKeys.findFirst({
          where: (table, { eq }) => eq(table.organizationId, input.organizationId),
          orderBy: (table, { desc }) => [desc(table.version)],
        });

  if (input.parsedSecrets.length > 0 && organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const unwrappedOrganizationCredentialKey =
    organizationCredentialKey === undefined
      ? undefined
      : unwrapOrganizationCredentialKey({
          wrappedCiphertext: organizationCredentialKey.ciphertext,
          masterEncryptionKeyMaterial: resolveMasterEncryptionKeyMaterial({
            masterKeyVersion: organizationCredentialKey.masterKeyVersion,
            masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
          }),
        });

  try {
    return await input.db.transaction(async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      if (input.redirectSession !== undefined) {
        const consumedSessionRows = await tx
          .update(tables.integrationConnectionRedirectSessions)
          .set({
            usedAt: sql`now()`,
          })
          .where(
            and(
              eq(tables.integrationConnectionRedirectSessions.id, input.redirectSession.id),
              isNull(tables.integrationConnectionRedirectSessions.usedAt),
            ),
          )
          .returning({
            id: tables.integrationConnectionRedirectSessions.id,
          });

        if (consumedSessionRows.length !== 1) {
          throw new BadRequestError(
            IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
            "Redirect state has already been used.",
          );
        }
      }

      for (const parsedSecret of input.parsedSecrets) {
        if (
          unwrappedOrganizationCredentialKey === undefined ||
          organizationCredentialKey === undefined
        ) {
          throw new Error("Organization credential key is required to persist setup secrets.");
        }

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
            intendedFamilyId: input.connection.target.familyId,
          })
          .returning({
            id: tables.integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create integration credential.");
        }

        await tx
          .insert(tables.integrationConnectionCredentials)
          .values({
            connectionId: input.connection.id,
            credentialId: createdCredential.id,
            slotKey: parsedSecret.persistedSecretRef.slotKey,
          })
          .onConflictDoUpdate({
            target: [
              tables.integrationConnectionCredentials.connectionId,
              tables.integrationConnectionCredentials.slotKey,
            ],
            set: {
              credentialId: createdCredential.id,
            },
          });
      }

      const connectionUpdate = input.connectionUpdate;
      const [updatedConnection] = await tx
        .update(tables.integrationConnections)
        .set({
          ...(connectionUpdate?.config === undefined ? {} : { config: connectionUpdate.config }),
          ...(connectionUpdate?.externalSubjectId === undefined
            ? {}
            : { externalSubjectId: connectionUpdate.externalSubjectId }),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tables.integrationConnections.id, input.connection.id),
            eq(tables.integrationConnections.organizationId, input.organizationId),
          ),
        )
        .returning();

      if (updatedConnection === undefined) {
        throw new NotFoundError(
          IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
          `Integration connection '${input.connection.id}' was not found.`,
        );
      }

      const webhookSourceCapability = input.definition.webhookSource;
      const supportsImplicitWebhookSource =
        webhookSourceCapability !== undefined &&
        webhookSourceCapability.lifecycle === IntegrationWebhookSourceLifecycles.IMPLICIT &&
        ((await webhookSourceCapability.supportsConnection?.({
          connection: {
            id: updatedConnection.id,
            status: updatedConnection.status,
            config: updatedConnection.config ?? {},
          },
        })) ??
          true);

      if (input.webhookSourceUpdate !== undefined && !supportsImplicitWebhookSource) {
        throw new Error(
          `Provider app setup for connection '${updatedConnection.id}' returned webhook source updates, but the integration does not support an implicit webhook source.`,
        );
      }

      if (supportsImplicitWebhookSource) {
        const webhookSource = await ensureImplicitConnectionWebhookSource({
          db: tx,
          organizationId: input.organizationId,
          connectionId: updatedConnection.id,
          targetKey: updatedConnection.targetKey,
        });

        const providerMetadata = input.webhookSourceUpdate?.providerMetadata;
        if (providerMetadata !== undefined) {
          const updatedSources = await tx
            .update(tables.integrationWebhookSources)
            .set({
              providerMetadata: {
                ...webhookSource.providerMetadata,
                ...providerMetadata,
              },
            })
            .where(eq(tables.integrationWebhookSources.id, webhookSource.id))
            .returning({
              id: tables.integrationWebhookSources.id,
            });

          if (updatedSources.length !== 1) {
            throw new Error(`Failed to update webhook source '${webhookSource.id}'.`);
          }
        }
      }

      return {
        id: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      };
    });
  } finally {
    unwrappedOrganizationCredentialKey?.fill(0);
  }
}
