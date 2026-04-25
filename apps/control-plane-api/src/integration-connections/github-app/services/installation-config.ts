import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  GitHubTargetConfigSchema,
  parseGitHubAppInstallationConnectionConfig,
} from "@mistle/integrations-definitions";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";

type InvalidGitHubAppInstallationConfigCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT;

type InvalidGitHubTargetConfigCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT;

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

export function assertGitHubAppInstallationConnectionMethodOrThrow(input: {
  connectionId: string;
  config: Record<string, unknown> | null;
}): void {
  if (
    input.config?.["connection_method"] !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration connection '${input.connectionId}' does not use GitHub App installation auth.`,
    );
  }
}

export function parseGitHubAppInstallationConnectionConfigOrThrow(input: {
  config: unknown;
  connectionId: string;
  invalidInputCode: InvalidGitHubAppInstallationConfigCode;
}) {
  const configRecord = toUnknownRecord(input.config);

  if (configRecord !== null) {
    assertGitHubAppInstallationConnectionMethodOrThrow({
      connectionId: input.connectionId,
      config: configRecord,
    });
  }

  try {
    return parseGitHubAppInstallationConnectionConfig(input.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration connection '${input.connectionId}' has invalid GitHub App configuration.`,
      );
    }

    throw error;
  }
}

export function parseGitHubTargetConfigOrThrow(input: {
  config: unknown;
  targetKey: string;
  invalidInputCode: InvalidGitHubTargetConfigCode;
}): z.output<typeof GitHubTargetConfigSchema> {
  try {
    return GitHubTargetConfigSchema.parse(input.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target config.`,
      );
    }

    throw error;
  }
}
