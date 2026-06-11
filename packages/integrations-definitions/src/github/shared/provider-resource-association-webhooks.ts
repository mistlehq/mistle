import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  IntegrationConnectionMethodIds,
  type AssociatedProviderResourceKind,
  type AssociatedResourceProviderActor,
  type AssociatedResourceEventType,
  type AssociatedResourceWebhookObservation,
  type AssociatedResourceSelfAuthorshipInput,
  type IntegrationAssociatedResourceEventsCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import { parseGitHubConnectionConfig, type GitHubConnectionConfig } from "./auth.js";
import { createGitHubPullRequestProviderResourceId } from "./provider-resource-associations.js";

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
  resourceKind: Extract<AssociatedProviderResourceKind, "github.pull_request">;
  text: string;
};

export type GitHubAssociatedResourceWebhookObservation = {
  actor?: AssociatedResourceProviderActor | undefined;
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  renderedInput: GitHubAssociatedResourceRenderedInput;
  resourceKind: Extract<AssociatedProviderResourceKind, "github.pull_request">;
};

export const GitHubAssociatedResourceEventsCapability: IntegrationAssociatedResourceEventsCapability<GitHubConnectionConfig> =
  {
    observeWebhookEvent: observeGitHubAssociatedResourceFromWebhookEvent,
    isSelfAuthoredEvent: isSelfAuthoredGitHubAssociatedResourceEvent,
  };

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
  input: AssociatedResourceSelfAuthorshipInput<GitHubConnectionConfig | Record<string, unknown>>,
): boolean {
  const parsedConnectionConfig = tryParseGitHubConnectionConfig(input.connection.config);
  if (
    parsedConnectionConfig === null ||
    parsedConnectionConfig.connection_method !==
      IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return false;
  }

  const actorHandle = input.observation.actor?.handle;
  if (actorHandle === undefined) {
    return false;
  }

  return (
    normalizeGitHubLogin(actorHandle) ===
    normalizeGitHubLogin(`${parsedConnectionConfig.app_slug}[bot]`)
  );
}

function tryParseGitHubConnectionConfig(input: unknown): GitHubConnectionConfig | null {
  try {
    return parseGitHubConnectionConfig(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return null;
    }

    throw error;
  }
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
