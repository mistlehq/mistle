import { GitHubCloudBrowserDefinition } from "@mistle/integrations-definitions/browser";

import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterOption,
} from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventOption } from "./webhook-trigger-option-builders.js";

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
  overrides?: Partial<WebhookTriggerEventOption>;
}): WebhookTriggerEventOption {
  const eventDefinition = GitHubCloudBrowserDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === input.eventType,
  );

  if (eventDefinition === undefined) {
    throw new Error(`Missing GitHub event definition for '${input.eventType}'.`);
  }

  return {
    ...createWebhookTriggerEventOption({
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
): WebhookTriggerEventParameterOption {
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
  overrides?: Partial<WebhookTriggerEventOption>,
): WebhookTriggerEventOption {
  return createGitHubEventOption({
    eventType: "github.issue_comment.created",
    ...(overrides === undefined ? {} : { overrides }),
  });
}

export function createGithubPullRequestOpenedEventOption(
  overrides?: Partial<WebhookTriggerEventOption>,
): WebhookTriggerEventOption {
  return createGitHubEventOption({
    eventType: "github.pull_request.opened",
    ...(overrides === undefined ? {} : { overrides }),
  });
}
