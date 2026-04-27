import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { buildUrlWithPath } from "@mistle/http";
import { BadRequestError } from "@mistle/http/errors.js";
import { type IntegrationRegistry } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "../../services/form-connection-methods.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeSlackAppInstallationStateMetadata,
  persistRedirectSessionOrThrow,
} from "../../services/redirect-flow.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "../../services/webhook-sources.js";
import { buildSlackAppInstallationCompleteUrl, buildSlackAppManifest } from "./manifest-builder.js";
import {
  assertSlackAppConnectionMethodOrThrow,
  parseSlackTargetConfigOrThrow,
} from "./slack-app-config.js";

type StartSlackAppManifestConnectionInput = {
  organizationId: string;
  connectionId: string;
  controlPlaneBaseUrl: string;
  manifest: Record<string, unknown>;
  appConfigToken: string;
};

type StartedSlackAppManifestConnection = {
  authorizationUrl: string;
};

const SlackManifestCreateSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    app_id: z.string().min(1),
    credentials: z
      .object({
        client_id: z.string().min(1),
        client_secret: z.string().min(1),
        signing_secret: z.string().min(1),
      })
      .loose(),
    oauth_authorize_url: z.url(),
  })
  .loose();

const SlackManifestCreateErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().min(1),
    errors: z
      .array(
        z
          .object({
            message: z.string().min(1),
            pointer: z.string().min(1).optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

type SlackManifestCreateSuccessResponse = z.output<typeof SlackManifestCreateSuccessResponseSchema>;

async function createSlackManifest(input: {
  apiBaseUrl: string;
  appConfigToken: string;
  manifest: Record<string, unknown>;
}): Promise<SlackManifestCreateSuccessResponse> {
  const response = await fetch(buildUrlWithPath(input.apiBaseUrl, "apps.manifest.create"), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.appConfigToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      manifest: JSON.stringify(input.manifest),
    }),
  });

  const responseJson: unknown = await response.json();
  if (!response.ok) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      `Slack app manifest creation failed with status ${response.status.toString()}.`,
    );
  }

  const errorResult = SlackManifestCreateErrorResponseSchema.safeParse(responseJson);
  if (errorResult.success) {
    const details =
      errorResult.data.errors === undefined
        ? ""
        : ` ${errorResult.data.errors
            .map((entry) =>
              entry.pointer === undefined ? entry.message : `${entry.pointer}: ${entry.message}`,
            )
            .join(" ")}`;
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      `Slack app manifest creation failed: ${errorResult.data.error}.${details}`,
    );
  }

  try {
    return SlackManifestCreateSuccessResponseSchema.parse(responseJson);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
        "Slack app manifest creation response is invalid.",
      );
    }

    throw error;
  }
}

function buildSlackManifestConnectionConfig(input: { clientId: string }): Record<string, string> {
  return {
    connection_method: SlackConnectionMethodId,
    client_id: input.clientId,
  };
}

function buildSlackManifestConnectionSecrets(input: {
  clientSecret: string;
  signingSecret: string;
}): Record<string, string> {
  return {
    clientSecret: input.clientSecret,
    signingSecret: input.signingSecret,
  };
}

export async function startSlackAppManifestConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: StartSlackAppManifestConnectionInput,
): Promise<StartedSlackAppManifestConnection> {
  if (input.appConfigToken.trim().length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      "Slack app configuration token is required.",
    );
  }

  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  assertSlackAppConnectionMethodOrThrow({
    connectionId: connection.id,
    config: connectionConfig,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
  });

  const parsedTargetConfig = parseSlackTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
  });

  const {
    webhookSourceCapability,
    parsedTargetConfig: parsedWebhookTargetConfig,
    parsedTargetSecrets,
  } = resolveWebhookSourceCapabilityOrThrow({
    integrationRegistry: ctx.integrationRegistry,
    integrationsConfig: ctx.integrationsConfig,
    target: connection.target,
  });
  const webhookSource = await ensureImplicitConnectionWebhookSource({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: connection.id,
    targetKey: connection.targetKey,
  });
  const webhookSourceDescriptor = await webhookSourceCapability.describeSource({
    organizationId: connection.organizationId,
    targetKey: connection.targetKey,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    target: {
      familyId: connection.target.familyId,
      variantId: connection.target.variantId,
      enabled: connection.target.enabled,
      config: parsedWebhookTargetConfig,
      secrets: parsedTargetSecrets,
    },
    connection: {
      id: connection.id,
      status: connection.status,
      config: connectionConfig,
    },
    source: {
      id: webhookSource.id,
      targetKey: webhookSource.targetKey,
      organizationId: webhookSource.organizationId,
      integrationConnectionId: webhookSource.integrationConnectionId,
      endpointKey: webhookSource.endpointKey,
      providerMetadata: webhookSource.providerMetadata,
      ...(webhookSource.displayName === null || webhookSource.displayName === undefined
        ? {}
        : { displayName: webhookSource.displayName }),
      ...(webhookSource.remoteRegistrationId === null ||
      webhookSource.remoteRegistrationId === undefined
        ? {}
        : { remoteRegistrationId: webhookSource.remoteRegistrationId }),
    },
  });

  if (webhookSourceDescriptor.callbackUrl === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      `Slack app manifest setup for connection '${connection.id}' requires a webhook callback URL.`,
    );
  }

  const state = encodeSlackAppInstallationStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
  });
  const manifest = buildSlackAppManifest({
    manifest: input.manifest,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    webhookCallbackUrl: webhookSourceDescriptor.callbackUrl,
  });
  const createdManifest = await createSlackManifest({
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    appConfigToken: input.appConfigToken.trim(),
    manifest,
  });

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: SlackConnectionMethodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: buildSlackManifestConnectionSecrets({
      clientSecret: createdManifest.credentials.client_secret,
      signingSecret: createdManifest.credentials.signing_secret,
    }),
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT,
  });

  const organizationCredentialKey = await ctx.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Organization credential key is missing for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    await ctx.db.transaction(async (tx) => {
      await persistRedirectSessionOrThrow({
        db: tx,
        organizationId: input.organizationId,
        targetKey: connection.targetKey,
        state,
        expiresAt: createRedirectSessionExpiryTimestamp(),
        failureMessage: "Failed to persist Slack app installation redirect session state.",
      });

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: input.organizationId,
            secretKind: parsedSecret.persistedSecretRef.secretKind,
            ciphertext: encryptedSecret.ciphertext,
            nonce: encryptedSecret.nonce,
            organizationCredentialKeyVersion: organizationCredentialKey.version,
            intendedFamilyId: connection.target.familyId,
          })
          .returning({
            id: integrationCredentials.id,
          });

        if (createdCredential === undefined) {
          throw new Error("Failed to create Slack integration credential.");
        }

        await tx
          .insert(integrationConnectionCredentials)
          .values({
            connectionId: connection.id,
            credentialId: createdCredential.id,
            slotKey: parsedSecret.persistedSecretRef.slotKey,
          })
          .onConflictDoUpdate({
            target: [
              integrationConnectionCredentials.connectionId,
              integrationConnectionCredentials.slotKey,
            ],
            set: {
              credentialId: createdCredential.id,
            },
          });
      }

      await tx
        .update(integrationConnections)
        .set({
          config: buildSlackManifestConnectionConfig({
            clientId: createdManifest.credentials.client_id,
          }),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.organizationId, input.organizationId),
          ),
        );
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }

  const authorizationUrl = new URL(createdManifest.oauth_authorize_url);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    buildSlackAppInstallationCompleteUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    }),
  );

  return {
    authorizationUrl: authorizationUrl.toString(),
  };
}
