import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedResourceProviderActor,
  type AssociatedResourceEventType,
  type AssociatedResourceSelfAuthorshipInput,
  type IntegrationAssociatedResourceEventDefinition,
  type IntegrationAssociatedResourceEventsCapability,
  type IntegrationWebhookEventDefinition,
  type IntegrationWebhookEventParameterGroupDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  GitHubAppInstallationConnectionConfigSchema,
  type GitHubConnectionConfig,
} from "./auth.js";
import {
  createGitHubPullRequestProviderResourceId,
  observeGitHubRoutableResourceFromEgressResponse,
} from "./provider-resource-associations.js";
import { GitHubSupportedWebhookEvents } from "./supported-webhook-events.js";

const GitHubIssueCommentPullRequestPayloadSchema = z.looseObject({
  issue: z.looseObject({
    number: z.number().int().positive(),
    pull_request: z.looseObject({}),
  }),
  repository: z.looseObject({
    full_name: z.string().min(1),
  }),
  comment: z.looseObject({
    body: z.string(),
  }),
  sender: z
    .looseObject({
      login: z.string().min(1),
    })
    .optional(),
});

const GitHubPullRequestReviewPayloadSchema = z.looseObject({
  pull_request: z.looseObject({
    number: z.number().int().positive(),
  }),
  repository: z.looseObject({
    full_name: z.string().min(1),
  }),
  review: z.looseObject({
    body: z.string().nullable().optional(),
    state: z.string().min(1),
  }),
  sender: z
    .looseObject({
      login: z.string().min(1),
    })
    .optional(),
});

const GitHubPullRequestReviewCommentPayloadSchema = z.looseObject({
  pull_request: z.looseObject({
    number: z.number().int().positive(),
  }),
  repository: z.looseObject({
    full_name: z.string().min(1),
  }),
  comment: z.looseObject({
    body: z.string(),
    line: z.number().int().positive().nullable().optional(),
    original_line: z.number().int().positive().nullable().optional(),
    path: z.string().min(1).nullable().optional(),
  }),
  sender: z
    .looseObject({
      login: z.string().min(1),
    })
    .optional(),
});

export type GitHubAssociatedResourceRenderedInput = {
  kind: "github.pull_request.associated_resource_event";
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  resourceKind: "github.pull_request";
  text: string;
};

export type GitHubAssociatedResourceWebhookObservation = {
  actor?: AssociatedResourceProviderActor | undefined;
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  renderedInput: GitHubAssociatedResourceRenderedInput;
  resourceKind: "github.pull_request";
};

export const GitHubAssociatedResourceEventsCapability: IntegrationAssociatedResourceEventsCapability<GitHubConnectionConfig> =
  {
    supportedEvents: createGitHubAssociatedResourceEventDefinitions(),
    defaultRoutingResources: () => [
      {
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        eventTypes: [
          AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
          AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
          AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
        ],
      },
    ],
    observeEgressResponse: observeGitHubRoutableResourceFromEgressResponse,
    observeWebhookEvent: observeGitHubAssociatedResourceFromWebhookEvent,
    isSelfAuthoredEvent: isSelfAuthoredGitHubAssociatedResourceEvent,
  };

function createGitHubAssociatedResourceEventDefinitions(): IntegrationAssociatedResourceEventDefinition[] {
  return [
    createGitHubAssociatedResourceEventDefinition({
      associationEventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
      displayName: "PR comments",
      omittedParameterIds: new Set(["target"]),
      webhookEventType: "github.issue_comment.created",
    }),
    createGitHubAssociatedResourceEventDefinition({
      associationEventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
      displayName: "PR reviews",
      omittedParameterIds: new Set(),
      webhookEventType: "github.pull_request_review.submitted",
    }),
    createGitHubAssociatedResourceEventDefinition({
      associationEventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
      displayName: "Review comments",
      omittedParameterIds: new Set(),
      webhookEventType: "github.pull_request_review_comment.created",
    }),
  ];
}

function createGitHubAssociatedResourceEventDefinition(input: {
  associationEventType: AssociatedResourceEventType;
  displayName: string;
  omittedParameterIds: ReadonlySet<string>;
  webhookEventType: string;
}): IntegrationAssociatedResourceEventDefinition {
  const webhookEventDefinition = resolveGitHubWebhookEventDefinition(input.webhookEventType);
  const parameters = (webhookEventDefinition.parameters ?? []).filter(
    (parameter) => !input.omittedParameterIds.has(parameter.id),
  );
  const parameterIds = new Set(parameters.map((parameter) => parameter.id));
  const parameterGroups = filterParameterGroupsForParameters({
    parameterGroups: webhookEventDefinition.parameterGroups ?? [],
    parameterIds,
  });

  return {
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    eventType: input.associationEventType,
    displayName: input.displayName,
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(parameterGroups.length === 0 ? {} : { parameterGroups }),
  };
}

function resolveGitHubWebhookEventDefinition(eventType: string): IntegrationWebhookEventDefinition {
  const eventDefinition = GitHubSupportedWebhookEvents.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (eventDefinition === undefined) {
    throw new Error(`GitHub webhook event definition '${eventType}' was not found.`);
  }

  return eventDefinition;
}

function filterParameterGroupsForParameters(input: {
  parameterGroups: readonly IntegrationWebhookEventParameterGroupDefinition[];
  parameterIds: ReadonlySet<string>;
}): IntegrationWebhookEventParameterGroupDefinition[] {
  return input.parameterGroups.flatMap((parameterGroup) => {
    const options = parameterGroup.options.filter((option) =>
      input.parameterIds.has(option.parameterId),
    );
    if (options.length < 2) {
      return [];
    }

    return [
      {
        id: parameterGroup.id,
        label: parameterGroup.label,
        kind: parameterGroup.kind,
        options,
      },
    ];
  });
}

export function observeGitHubAssociatedResourceFromWebhookEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
}): GitHubAssociatedResourceWebhookObservation | null {
  switch (input.eventType) {
    case "github.issue_comment.created":
      return observeIssueCommentCreated(input.payload);
    case "github.pull_request_review.submitted":
      return observePullRequestReviewSubmitted(input.payload);
    case "github.pull_request_review_comment.created":
      return observePullRequestReviewCommentCreated(input.payload);
    default:
      return null;
  }
}

function observeIssueCommentCreated(
  payload: Record<string, unknown>,
): GitHubAssociatedResourceWebhookObservation | null {
  const parsedPayload = GitHubIssueCommentPullRequestPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return null;
  }

  return createObservation({
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
    actor: createActorFromSenderLogin(parsedPayload.data.sender?.login),
    pullRequestNumber: parsedPayload.data.issue.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    text: renderIssueCommentInput({
      author: parsedPayload.data.sender?.login,
      body: parsedPayload.data.comment.body,
      eventType: GitHubWebhookEventTypes.ISSUE_COMMENT_CREATED,
      pullRequestNumber: parsedPayload.data.issue.number,
      repositoryFullName: parsedPayload.data.repository.full_name,
    }),
  });
}

function observePullRequestReviewSubmitted(
  payload: Record<string, unknown>,
): GitHubAssociatedResourceWebhookObservation | null {
  const parsedPayload = GitHubPullRequestReviewPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return null;
  }

  return createObservation({
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
    actor: createActorFromSenderLogin(parsedPayload.data.sender?.login),
    pullRequestNumber: parsedPayload.data.pull_request.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    text: renderReviewSubmittedInput({
      author: parsedPayload.data.sender?.login,
      body: parsedPayload.data.review.body ?? "",
      eventType: GitHubWebhookEventTypes.PULL_REQUEST_REVIEW_SUBMITTED,
      pullRequestNumber: parsedPayload.data.pull_request.number,
      repositoryFullName: parsedPayload.data.repository.full_name,
      state: parsedPayload.data.review.state,
    }),
  });
}

function observePullRequestReviewCommentCreated(
  payload: Record<string, unknown>,
): GitHubAssociatedResourceWebhookObservation | null {
  const parsedPayload = GitHubPullRequestReviewCommentPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return null;
  }

  return createObservation({
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
    actor: createActorFromSenderLogin(parsedPayload.data.sender?.login),
    pullRequestNumber: parsedPayload.data.pull_request.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    text: renderReviewCommentInput({
      author: parsedPayload.data.sender?.login,
      body: parsedPayload.data.comment.body,
      eventType: GitHubWebhookEventTypes.PULL_REQUEST_REVIEW_COMMENT_CREATED,
      filePath: parsedPayload.data.comment.path ?? "",
      line: parsedPayload.data.comment.line ?? parsedPayload.data.comment.original_line ?? null,
      pullRequestNumber: parsedPayload.data.pull_request.number,
      repositoryFullName: parsedPayload.data.repository.full_name,
    }),
  });
}

function createObservation(input: {
  actor?: AssociatedResourceProviderActor | undefined;
  eventType: AssociatedResourceEventType;
  pullRequestNumber: number;
  repositoryFullName: string;
  text: string;
}): GitHubAssociatedResourceWebhookObservation {
  const providerResourceId = createGitHubPullRequestProviderResourceId({
    repositoryFullName: input.repositoryFullName,
    pullRequestNumber: input.pullRequestNumber,
  });
  const resourceKind = AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST;

  return {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    eventType: input.eventType,
    providerResourceId,
    resourceKind,
    renderedInput: {
      kind: "github.pull_request.associated_resource_event",
      eventType: input.eventType,
      providerResourceId,
      resourceKind,
      text: input.text,
    },
  };
}

export function isSelfAuthoredGitHubAssociatedResourceEvent(
  input: AssociatedResourceSelfAuthorshipInput<GitHubConnectionConfig>,
): boolean {
  const parsedConnectionConfig = GitHubAppInstallationConnectionConfigSchema.safeParse(
    input.connection.config,
  );
  if (!parsedConnectionConfig.success) {
    return false;
  }

  const actorHandle = input.observation.actor?.handle;
  if (actorHandle === undefined) {
    return false;
  }

  return (
    normalizeGitHubLogin(actorHandle) ===
    normalizeGitHubLogin(`${parsedConnectionConfig.data.app_slug}[bot]`)
  );
}

function normalizeGitHubLogin(input: string): string {
  return input.toLowerCase();
}

function createActorFromSenderLogin(
  senderLogin: string | undefined,
): AssociatedResourceProviderActor | undefined {
  if (senderLogin === undefined) {
    return undefined;
  }

  return {
    handle: senderLogin,
  };
}

const GitHubWebhookEventTypes = {
  ISSUE_COMMENT_CREATED: "github.issue_comment.created",
  PULL_REQUEST_REVIEW_SUBMITTED: "github.pull_request_review.submitted",
  PULL_REQUEST_REVIEW_COMMENT_CREATED: "github.pull_request_review_comment.created",
};

function renderIssueCommentInput(input: {
  author?: string | undefined;
  body: string;
  eventType: string;
  pullRequestNumber: number;
  repositoryFullName: string;
}): string {
  return renderLines([
    `Repository: ${input.repositoryFullName}`,
    `Event type: ${input.eventType}`,
    ...renderOptionalAuthor(input.author),
    "",
    "Pull request issue comment:",
    `PR #${String(input.pullRequestNumber)}`,
    `Comment body: ${input.body}`,
  ]);
}

function renderReviewSubmittedInput(input: {
  author?: string | undefined;
  body: string;
  eventType: string;
  pullRequestNumber: number;
  repositoryFullName: string;
  state: string;
}): string {
  return renderLines([
    `Repository: ${input.repositoryFullName}`,
    `Event type: ${input.eventType}`,
    ...renderOptionalAuthor(input.author),
    "",
    "Pull request review submitted:",
    `PR #${String(input.pullRequestNumber)}`,
    `Review state: ${input.state}`,
    `Review body: ${input.body}`,
  ]);
}

function renderReviewCommentInput(input: {
  author?: string | undefined;
  body: string;
  eventType: string;
  filePath: string;
  line: number | null;
  pullRequestNumber: number;
  repositoryFullName: string;
}): string {
  const line = input.line === null ? "" : String(input.line);

  return renderLines([
    `Repository: ${input.repositoryFullName}`,
    `Event type: ${input.eventType}`,
    ...renderOptionalAuthor(input.author),
    "",
    "Pull request review comment:",
    `PR #${String(input.pullRequestNumber)}`,
    `File: ${input.filePath}`,
    `Line: ${line}`,
    `Comment body: ${input.body}`,
  ]);
}

function renderOptionalAuthor(author: string | undefined): readonly string[] {
  return author === undefined ? [] : [`Author: ${author}`];
}

function renderLines(lines: readonly string[]): string {
  return lines.join("\n");
}
