import {
  integrationConnectionCredentials,
  integrationConnectionRedirectSessions,
  integrationConnections,
  integrationCredentials,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import type { AppContext } from "../../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../../constants.js";
import {
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "../../services/form-connection-methods.js";
import {
  createRedirectQueryParams,
  resolveActiveRedirectSessionOrThrow,
  resolveGitHubAppManifestConnectionId,
  resolveRequiredRedirectQueryParamOrThrow,
} from "../../services/redirect-flow.js";
import { buildUrlWithPath } from "../../services/url-path.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionWithTargetOrThrow,
} from "../../services/webhook-sources.js";
import {
  assertGitHubAppInstallationConnectionMethodOrThrow,
  parseGitHubTargetConfigOrThrow,
} from "./installation-config.js";

type CompleteGitHubAppManifestConnectionInput = {
  query: Record<string, string>;
};

type CompletedConnection = {
  id: string;
  targetKey: string;
};

const GitHubAppManifestConversionResponseSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int().nonnegative()]),
    slug: z.string().min(1),
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    pem: z.string().min(1),
    webhook_secret: z.string().min(1),
  })
  .loose();

type GitHubAppManifestConversion = z.output<typeof GitHubAppManifestConversionResponseSchema>;

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "state",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
    missingMessage: "GitHub App manifest callback query must include `state`.",
  });
}

function resolveManifestCodeOrThrow(params: URLSearchParams): string {
  return resolveRequiredRedirectQueryParamOrThrow({
    params,
    name: "code",
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
    missingMessage: "GitHub App manifest callback query must include `code`.",
  });
}

function resolveGitHubAppManifestConnectionIdOrThrow(state: string): string {
  try {
    return resolveGitHubAppManifestConnectionId(state);
  } catch {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }
}

function buildGitHubAppManifestConversionUrl(input: { apiBaseUrl: string; code: string }): string {
  return buildUrlWithPath(
    input.apiBaseUrl,
    `/app-manifests/${encodeURIComponent(input.code)}/conversions`,
  );
}

export function parseGitHubAppManifestConversionResponse(
  value: unknown,
): GitHubAppManifestConversion {
  try {
    return GitHubAppManifestConversionResponseSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
        "GitHub App manifest conversion response is invalid.",
      );
    }

    throw error;
  }
}

async function convertGitHubAppManifest(input: {
  apiBaseUrl: string;
  code: string;
}): Promise<GitHubAppManifestConversion> {
  const response = await fetch(
    buildGitHubAppManifestConversionUrl({
      apiBaseUrl: input.apiBaseUrl,
      code: input.code,
    }),
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
      `GitHub App manifest conversion failed with status ${response.status.toString()}.${responseBody.length === 0 ? "" : ` Response body: ${responseBody}`}`,
    );
  }

  const responseJson: unknown = await response.json();
  return parseGitHubAppManifestConversionResponse(responseJson);
}

export function buildConvertedGitHubAppConnectionConfig(input: {
  conversion: GitHubAppManifestConversion;
}): Record<string, string> {
  return {
    connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    app_id: input.conversion.id.toString(),
    app_slug: input.conversion.slug,
    client_id: input.conversion.client_id,
  };
}

export function buildConvertedConnectionSecrets(input: {
  conversion: GitHubAppManifestConversion;
  supportsClientSecret: boolean;
}): Record<string, string> {
  if (!input.supportsClientSecret) {
    return {
      appPrivateKeyPem: input.conversion.pem,
      webhookSecret: input.conversion.webhook_secret,
    };
  }

  const clientSecret = input.conversion.client_secret;
  if (clientSecret === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
      "GitHub App manifest conversion response is missing `client_secret`.",
    );
  }

  return {
    appPrivateKeyPem: input.conversion.pem,
    webhookSecret: input.conversion.webhook_secret,
    clientSecret,
  };
}

export async function completeGitHubAppManifestConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: CompleteGitHubAppManifestConnectionInput,
): Promise<CompletedConnection> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);
  const code = resolveManifestCodeOrThrow(queryParams);

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db: ctx.db,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });

  const connectionId = resolveGitHubAppManifestConnectionIdOrThrow(state);
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: redirectSession.organizationId,
    connectionId,
  });

  if (connection.targetKey !== redirectSession.targetKey) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state does not match the target for this connection.",
    );
  }

  assertGitHubAppInstallationConnectionMethodOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });
  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const parsedTargetConfig = parseGitHubTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
  });

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  });
  const supportsClientSecret = formMethod.secretFields.some(
    (field) => field.name === "clientSecret",
  );
  const conversion = await convertGitHubAppManifest({
    apiBaseUrl: parsedTargetConfig.apiBaseUrl,
    code,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: buildConvertedConnectionSecrets({
      conversion,
      supportsClientSecret,
    }),
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT,
  });

  const organizationCredentialKey = await ctx.db.query.organizationCredentialKeys.findFirst({
    where: (table, { eq }) => eq(table.organizationId, redirectSession.organizationId),
    orderBy: (table, { desc }) => [desc(table.version)],
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key is missing for '${redirectSession.organizationId}'.`,
    );
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
    return await ctx.db.transaction(async (tx) => {
      const consumedSessionRows = await tx
        .update(integrationConnectionRedirectSessions)
        .set({
          usedAt: sql`now()`,
        })
        .where(
          and(
            eq(integrationConnectionRedirectSessions.id, redirectSession.id),
            isNull(integrationConnectionRedirectSessions.usedAt),
          ),
        )
        .returning({
          id: integrationConnectionRedirectSessions.id,
        });

      if (consumedSessionRows.length !== 1) {
        throw new BadRequestError(
          IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
          "Redirect state has already been used.",
        );
      }

      for (const parsedSecret of parsedSecrets) {
        const encryptedSecret = encryptCredentialUtf8({
          plaintext: parsedSecret.normalizedValue,
          organizationCredentialKey: unwrappedOrganizationCredentialKey,
        });

        const [createdCredential] = await tx
          .insert(integrationCredentials)
          .values({
            organizationId: redirectSession.organizationId,
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
          throw new Error("Failed to create integration credential.");
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

      const [updatedConnection] = await tx
        .update(integrationConnections)
        .set({
          config: buildConvertedGitHubAppConnectionConfig({ conversion }),
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.organizationId, redirectSession.organizationId),
          ),
        )
        .returning();

      if (updatedConnection === undefined) {
        throw new NotFoundError(
          IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
          `Integration connection '${connection.id}' was not found.`,
        );
      }

      await ensureImplicitConnectionWebhookSource({
        db: tx,
        organizationId: redirectSession.organizationId,
        connectionId: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      });

      return {
        id: updatedConnection.id,
        targetKey: updatedConnection.targetKey,
      };
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
