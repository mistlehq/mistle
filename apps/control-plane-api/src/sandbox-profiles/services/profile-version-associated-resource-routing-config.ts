import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  SandboxProfileAssociatedResourceEventRoutingConfigSchema,
  type AssociatedResourceEventRoutingResourceRule,
} from "@mistle/integrations-core";

type GitHubPullRequestAssociatedResourceEventType =
  | typeof AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED
  | typeof AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED
  | typeof AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED;

type SlackThreadAssociatedResourceEventType =
  typeof AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED;

type ApiAssociatedResourceEventRoutingResourceRule =
  | {
      resourceKind: typeof AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST;
      eventTypes: GitHubPullRequestAssociatedResourceEventType[];
      payloadFilter?: Record<string, unknown>;
    }
  | {
      resourceKind: typeof AssociatedProviderResourceKinds.SLACK_THREAD;
      eventTypes: SlackThreadAssociatedResourceEventType[];
      payloadFilter?: Record<string, unknown>;
    };

export type SandboxProfileAssociatedResourceEventRoutingConfig = {
  enabled?: boolean;
  resources?: ApiAssociatedResourceEventRoutingResourceRule[];
};

export function mapProfileVersionAssociatedResourceEventRoutingConfig(
  rawConfig: unknown,
): SandboxProfileAssociatedResourceEventRoutingConfig {
  const config = SandboxProfileAssociatedResourceEventRoutingConfigSchema.parse(rawConfig);

  return {
    ...(config.enabled === undefined ? {} : { enabled: config.enabled }),
    ...(config.resources === undefined
      ? {}
      : {
          resources: config.resources.map(copyAssociatedResourceEventRoutingResourceRule),
        }),
  };
}

function copyAssociatedResourceEventRoutingResourceRule(
  resource: AssociatedResourceEventRoutingResourceRule,
): ApiAssociatedResourceEventRoutingResourceRule {
  switch (resource.resourceKind) {
    case AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST:
      return {
        resourceKind: resource.resourceKind,
        eventTypes: [...resource.eventTypes],
        ...(resource.payloadFilter === undefined
          ? {}
          : { payloadFilter: structuredClone(resource.payloadFilter) }),
      };
    case AssociatedProviderResourceKinds.SLACK_THREAD:
      return {
        resourceKind: resource.resourceKind,
        eventTypes: [...resource.eventTypes],
        ...(resource.payloadFilter === undefined
          ? {}
          : { payloadFilter: structuredClone(resource.payloadFilter) }),
      };
  }
}
