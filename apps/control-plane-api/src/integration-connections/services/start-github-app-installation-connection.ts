import {
  integrationConnectionRedirectSessions,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import {
  GitHubTargetConfigSchema,
  parseGitHubAppInstallationConnectionConfig,
} from "@mistle/integrations-definitions";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeGitHubAppInstallationStateMetadata,
} from "./redirect-flow.js";
import { resolveConnectionWithTargetOrThrow } from "./webhook-sources.js";

export type StartGitHubAppInstallationConnectionInput = {
  organizationId: string;
  connectionId: string;
};

type StartedGitHubAppInstallationConnection = {
  authorizationUrl: string;
};

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function resolveGitHubAppInstallationConnectionConfigOrThrow(input: {
  config: unknown;
  connectionId: string;
}) {
  const configRecord = toUnknownRecord(input.config);

  if (
    configRecord !== null &&
    configRecord["connection_method"] !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration connection '${input.connectionId}' does not use GitHub App installation auth.`,
    );
  }

  try {
    return parseGitHubAppInstallationConnectionConfig(input.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
        `Integration connection '${input.connectionId}' has invalid GitHub App configuration.`,
      );
    }

    throw error;
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
    throw new Error("Failed to persist redirect session state.");
  }
}

function buildGitHubAppInstallationUrl(input: {
  appSlug: string;
  state: string;
  variantId: string;
  webBaseUrl: string;
}): string {
  const installationPath =
    input.variantId === "github-enterprise-server"
      ? `/github-apps/${input.appSlug}/installations/new`
      : `/apps/${input.appSlug}/installations/new`;
  const installUrl = new URL(installationPath, input.webBaseUrl);
  installUrl.searchParams.set("state", input.state);
  return installUrl.toString();
}

export async function startGitHubAppInstallationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: StartGitHubAppInstallationConnectionInput,
): Promise<StartedGitHubAppInstallationConnection> {
  const { db, integrationRegistry } = ctx;

  const connection = await resolveConnectionWithTargetOrThrow({
    db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const definition = integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      `Integration definition '${connection.target.familyId}/${connection.target.variantId}' is not registered.`,
    );
  }

  const parsedConnectionConfig = resolveGitHubAppInstallationConnectionConfigOrThrow({
    config: connection.config,
    connectionId: input.connectionId,
  });
  let parsedTargetConfig: z.output<typeof GitHubTargetConfigSchema>;
  try {
    parsedTargetConfig = GitHubTargetConfigSchema.parse(connection.target.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
        `Integration target '${connection.targetKey}' has invalid target config.`,
      );
    }

    throw error;
  }
  const state = encodeGitHubAppInstallationStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
  });

  await persistRedirectSession({
    db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state,
    expiresAt: createRedirectSessionExpiryTimestamp(),
  });

  return {
    authorizationUrl: buildGitHubAppInstallationUrl({
      appSlug: parsedConnectionConfig.app_slug,
      state,
      variantId: connection.target.variantId,
      webBaseUrl: parsedTargetConfig.webBaseUrl,
    }),
  };
}
