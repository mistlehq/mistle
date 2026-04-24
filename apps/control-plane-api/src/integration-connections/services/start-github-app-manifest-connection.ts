import {
  integrationConnectionRedirectSessions,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { GitHubTargetConfigSchema } from "@mistle/integrations-definitions";
import { z } from "zod";

import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeGitHubAppManifestStateMetadata,
} from "./redirect-flow.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "./webhook-sources.js";

export type GitHubAppManifestOwner =
  | {
      kind: "personal";
    }
  | {
      kind: "organization";
      organizationSlug: string;
    };

export type StartGitHubAppManifestConnectionInput = {
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

function appendUrlPath(input: { baseUrl: string; path: string }): string {
  const url = new URL(input.baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}${input.path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildGitHubAppManifestSubmissionUrl(input: {
  owner: GitHubAppManifestOwner;
  state: string;
  webBaseUrl: string;
}): string {
  const path =
    input.owner.kind === "personal"
      ? "/settings/apps/new"
      : `/organizations/${encodeURIComponent(input.owner.organizationSlug)}/settings/apps/new`;
  const submissionUrl = new URL(
    appendUrlPath({
      baseUrl: input.webBaseUrl,
      path,
    }),
  );
  submissionUrl.searchParams.set("state", input.state);
  return submissionUrl.toString();
}

function buildCallbackUrl(input: { controlPlaneBaseUrl: string; path: string }): string {
  return new URL(input.path, input.controlPlaneBaseUrl).toString();
}

function buildGitHubAppManifest(input: {
  manifest: Record<string, unknown>;
  controlPlaneBaseUrl: string;
  webhookCallbackUrl: string;
}): Record<string, unknown> {
  return {
    ...input.manifest,
    hook_attributes: {
      active: true,
      url: input.webhookCallbackUrl,
    },
    redirect_url: buildCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      path: "/p/integration/callbacks/github-app-manifest",
    }),
    callback_urls: [
      buildCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        path: "/p/identity-linking/callbacks/github",
      }),
    ],
    setup_url: buildCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      path: "/p/integration/callbacks/github-app-installation",
    }),
  };
}

function assertGitHubAppConnectionOrThrow(input: {
  connectionId: string;
  config: Record<string, unknown>;
}): void {
  if (
    input.config["connection_method"] !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration connection '${input.connectionId}' does not use GitHub App installation auth.`,
    );
  }
}

async function persistRedirectSession(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  targetKey: string;
  state: string;
  expiresAt: string;
}): Promise<void> {
  const insertedRows = await input.db
    .insert(integrationConnectionRedirectSessions)
    .values({
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      state: input.state,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: integrationConnectionRedirectSessions.state,
    })
    .returning({
      id: integrationConnectionRedirectSessions.id,
    });

  if (insertedRows.length !== 1) {
    throw new Error("Failed to persist GitHub App manifest redirect session state.");
  }
}

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
  assertGitHubAppConnectionOrThrow({
    connectionId: connection.id,
    config: connectionConfig,
  });

  let parsedTargetConfig: z.output<typeof GitHubTargetConfigSchema>;
  try {
    parsedTargetConfig = GitHubTargetConfigSchema.parse(connection.target.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
        `Integration target '${connection.targetKey}' has invalid target config.`,
      );
    }

    throw error;
  }

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

  const state = encodeGitHubAppManifestStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
  });
  await persistRedirectSession({
    db: ctx.db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state,
    expiresAt: createRedirectSessionExpiryTimestamp(),
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
