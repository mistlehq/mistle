import { GitHubCloudBrowserDefinition } from "@mistle/integrations-definitions/browser";

import { createWebhookAutomationEventOption } from "./webhook-automation-option-builders.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationEventParameterOption,
} from "./webhook-automation-trigger-types.js";

export const GitHubConnectionId = "icn_01kkk1g84mfetvga8a4b853k27";
export const GitHubWebhookSourceId = "iws_01kkk1g84mfetvga8a4b853k27";
export const GitHubConnectionLabel = "GitHub Engineering";
export const GitHubGroupedConnectionLabel = "GitHub - GitHub Engineering";
export const RepoMaintainerSandboxProfileId = "sbp_01kkk1mbmxfetvga8kcmw612jj";

export function createGitHubEventOption(input: {
  eventType: string;
  connectionId?: string;
  webhookSourceId?: string;
  connectionLabel?: string;
  categoryPrefix?: string;
  overrides?: Partial<WebhookAutomationEventOption>;
}): WebhookAutomationEventOption {
  const eventDefinition = GitHubCloudBrowserDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === input.eventType,
  );

  if (eventDefinition === undefined) {
    throw new Error(`Missing GitHub event definition for '${input.eventType}'.`);
  }

  return {
    ...createWebhookAutomationEventOption({
      eventDefinition,
      webhookSourceId: input.webhookSourceId ?? GitHubWebhookSourceId,
      connectionId: input.connectionId ?? GitHubConnectionId,
      connectionLabel: input.connectionLabel ?? GitHubConnectionLabel,
      logoKey: "github",
      ...(input.categoryPrefix === undefined ? {} : { categoryPrefix: input.categoryPrefix }),
    }),
    ...input.overrides,
  };
}

export function createInvocationTokenParameter(
  payloadPath: string[],
): WebhookAutomationEventParameterOption {
  return {
    id: "invocationToken",
    label: "invocation token",
    kind: "string",
    payloadPath,
    matchMode: "contains_token",
    controlVariant: "invocation-token",
  };
}

export function createGithubIssueCommentCreatedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return createGitHubEventOption({
    eventType: "github.issue_comment.created",
    ...(overrides === undefined ? {} : { overrides }),
  });
}

export function createGithubPullRequestOpenedEventOption(
  overrides?: Partial<WebhookAutomationEventOption>,
): WebhookAutomationEventOption {
  return createGitHubEventOption({
    eventType: "github.pull_request.opened",
    ...(overrides === undefined ? {} : { overrides }),
  });
}
