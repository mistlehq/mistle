import {
  integrationConnectionCredentials,
  IntegrationConnectionCredentialPurposes,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationConnectionRedirectSessions,
} from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, isNull } from "drizzle-orm";

import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../lib/crypto.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { createRedirectQueryParams, resolveRedirectDisplayName } from "./redirect-flow.js";
import { resolveGitHubAppInstallationHandlerTargetOrThrow } from "./resolve-github-app-installation-handler.js";

type CompleteGitHubAppInstallationConnectionInput = {
  targetKey: string;
  query: Record<string, string>;
};

type CompletedConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function resolveRedirectStateOrThrow(params: URLSearchParams): string {
  const state = params.get("state");
  if (state === null || state.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
      "GitHub App installation callback query must include `state`.",
    );
  }

  return state;
}

function resolveCredentialSecretKind(secretType: string) {
  if (secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return IntegrationCredentialSecretKinds.API_KEY;
  }

  throw new Error(`Unsupported GitHub App installation credential secret type '${secretType}'.`);
}

function resolveCredentialPurpose(purpose: string) {
  if (purpose === IntegrationConnectionCredentialPurposes.API_KEY) {
    return IntegrationConnectionCredentialPurposes.API_KEY;
  }

  if (purpose === IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN) {
    return IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN;
  }

  if (purpose === IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN) {
    return IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN;
  }

  throw new Error(`Unsupported GitHub App installation credential purpose '${purpose}'.`);
}

export async function completeGitHubAppInstallationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: CompleteGitHubAppInstallationConnectionInput,
): Promise<CompletedConnection> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const resolved = await resolveGitHubAppInstallationHandlerTargetOrThrow(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      targetKey: input.targetKey,
      invalidInputCode:
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT,
    },
  );

  const queryParams = createRedirectQueryParams(input.query);
  const state = resolveRedirectStateOrThrow(queryParams);

  const redirectSession = await db.query.integrationConnectionRedirectSessions.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.state, state)),
  });

  if (redirectSession === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state is invalid.",
    );
  }

  const requestedDisplayName = resolveRedirectDisplayName(redirectSession.state);

  if (redirectSession.usedAt !== null) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
      "Redirect state has already been used.",
    );
  }

  const now = Date.now();
  const expiresAt = Date.parse(redirectSession.expiresAt);
  if (Number.isNaN(expiresAt)) {
    throw new Error(`Redirect session '${redirectSession.id}' has an invalid expiry timestamp.`);
  }

  if (expiresAt <= now) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
      "Redirect state has expired.",
    );
  }

  const completedGitHubAppInstallationConnection = await resolved.redirectHandler.complete({
    organizationId: redirectSession.organizationId,
    targetKey: input.targetKey,
    target: resolved.target,
    query: queryParams,
  });

  return db.transaction(async (tx) => {
    const usedAtTimestamp = new Date().toISOString();
    const consumedSessionRows = await tx
      .update(integrationConnectionRedirectSessions)
      .set({
        usedAt: usedAtTimestamp,
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

    const [createdConnection] = await tx
      .insert(integrationConnections)
      .values({
        organizationId: redirectSession.organizationId,
        targetKey: input.targetKey,
        displayName:
          requestedDisplayName ??
          completedGitHubAppInstallationConnection.externalSubjectId ??
          input.targetKey,
        status: IntegrationConnectionStatuses.ACTIVE,
        ...(completedGitHubAppInstallationConnection.externalSubjectId === undefined
          ? {}
          : { externalSubjectId: completedGitHubAppInstallationConnection.externalSubjectId }),
        config: completedGitHubAppInstallationConnection.connectionConfig,
        targetSnapshotConfig: resolved.target.config,
      })
      .returning();

    if (createdConnection === undefined) {
      throw new Error(
        "Failed to create integration connection from GitHub App installation callback.",
      );
    }

    if (completedGitHubAppInstallationConnection.credentialMaterials.length > 0) {
      const organizationCredentialKey = await tx.query.organizationCredentialKeys.findFirst({
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
        masterEncryptionKeys: integrationsConfig.masterEncryptionKeys,
      });
      const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
        wrappedCiphertext: organizationCredentialKey.ciphertext,
        masterEncryptionKeyMaterial,
      });

      try {
        for (const material of completedGitHubAppInstallationConnection.credentialMaterials) {
          const encryptedCredential = encryptCredentialUtf8({
            plaintext: material.plaintext,
            organizationCredentialKey: unwrappedOrganizationCredentialKey,
          });

          const [createdCredential] = await tx
            .insert(integrationCredentials)
            .values({
              organizationId: redirectSession.organizationId,
              secretKind: resolveCredentialSecretKind(material.secretType),
              ciphertext: encryptedCredential.ciphertext,
              nonce: encryptedCredential.nonce,
              organizationCredentialKeyVersion: organizationCredentialKey.version,
              intendedFamilyId: resolved.target.familyId,
              ...(material.metadata === undefined ? {} : { metadata: material.metadata }),
            })
            .returning({
              id: integrationCredentials.id,
            });

          if (createdCredential === undefined) {
            throw new Error("Failed to create integration credential.");
          }

          await tx.insert(integrationConnectionCredentials).values({
            connectionId: createdConnection.id,
            credentialId: createdCredential.id,
            purpose: resolveCredentialPurpose(material.purpose),
          });
        }
      } finally {
        unwrappedOrganizationCredentialKey.fill(0);
      }
    }

    return {
      id: createdConnection.id,
      targetKey: createdConnection.targetKey,
      displayName: createdConnection.displayName,
      status: createdConnection.status,
      ...(createdConnection.externalSubjectId === null
        ? {}
        : { externalSubjectId: createdConnection.externalSubjectId }),
      ...(createdConnection.config === null ? {} : { config: createdConnection.config }),
      ...(createdConnection.targetSnapshotConfig === null
        ? {}
        : { targetSnapshotConfig: createdConnection.targetSnapshotConfig }),
      createdAt: createdConnection.createdAt,
      updatedAt: createdConnection.updatedAt,
    };
  });
}
