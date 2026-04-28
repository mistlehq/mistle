import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { type IntegrationRegistry } from "@mistle/integrations-core";
import {
  buildGitHubAppManifest,
  buildGitHubAppManifestSubmissionUrl,
  type GitHubAppManifestOwner,
} from "@mistle/integrations-definitions/server";

import type { AppContext } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeConnectionRedirectStateMetadata,
  persistRedirectSessionOrThrow,
} from "../../services/redirect-flow.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "../../services/webhook-sources.js";
import {
  assertGitHubAppInstallationConnectionMethodOrThrow,
  parseGitHubTargetConfigOrThrow,
} from "./installation-config.js";

type StartGitHubAppManifestConnectionInput = {
  organizationId: string;
  connectionId: string;
  controlPlaneBaseUrl: string;
  manifest: Record<string, unknown>;
  owner: GitHubAppManifestOwner;
};

type StartedGitHubAppManifestConnection = {
  submissionUrl: string;
  fields: {
    manifest: string;
  };
};

export async function startGitHubAppManifestConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: StartGitHubAppManifestConnectionInput,
): Promise<StartedGitHubAppManifestConnection> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  assertGitHubAppInstallationConnectionMethodOrThrow({
    connectionId: connection.id,
    config: connectionConfig,
  });

  const parsedTargetConfig = parseGitHubTargetConfigOrThrow({
    config: connection.target.config,
    targetKey: connection.targetKey,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
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
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
      `GitHub App manifest setup for connection '${connection.id}' requires a webhook callback URL.`,
    );
  }

  const state = encodeConnectionRedirectStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
  });
  await persistRedirectSessionOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state,
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist GitHub App manifest redirect session state.",
  });

  const manifest = buildGitHubAppManifest({
    manifest: input.manifest,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    webhookCallbackUrl: webhookSourceDescriptor.callbackUrl,
  });

  return {
    submissionUrl: buildGitHubAppManifestSubmissionUrl({
      owner: input.owner,
      webBaseUrl: parsedTargetConfig.webBaseUrl,
      state,
    }),
    fields: {
      manifest: JSON.stringify(manifest),
    },
  };
}
