import { BadRequestError } from "@mistle/http/errors.js";
import { SlackConnectionMethodId, SlackTargetConfigSchema } from "@mistle/integrations-definitions";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";

type InvalidSlackTargetConfigCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT;

export function assertSlackAppConnectionMethodOrThrow(input: {
  connectionId: string;
  config: Record<string, unknown> | null;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT;
}): void {
  if (input.config?.["connection_method"] !== SlackConnectionMethodId) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration connection '${input.connectionId}' does not use Slack app auth.`,
    );
  }
}

export function parseSlackTargetConfigOrThrow(input: {
  config: unknown;
  targetKey: string;
  invalidInputCode: InvalidSlackTargetConfigCode;
}): z.output<typeof SlackTargetConfigSchema> {
  try {
    return SlackTargetConfigSchema.parse(input.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid Slack target config.`,
      );
    }

    throw error;
  }
}
