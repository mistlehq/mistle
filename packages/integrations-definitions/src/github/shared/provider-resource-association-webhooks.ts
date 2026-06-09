import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedProviderResourceKind,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";
import { z } from "zod";

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
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  renderedInput: GitHubAssociatedResourceRenderedInput;
  resourceKind: Extract<AssociatedProviderResourceKind, "github.pull_request">;
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
    body: parsedPayload.data.comment.body,
    eventLabel: "GitHub pull request issue comment created",
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
    pullRequestNumber: parsedPayload.data.issue.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    senderLogin: parsedPayload.data.sender?.login,
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
    body: parsedPayload.data.review.body ?? null,
    eventLabel: `GitHub pull request review ${parsedPayload.data.review.state}`,
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
    pullRequestNumber: parsedPayload.data.pull_request.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    senderLogin: parsedPayload.data.sender?.login,
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
    body: parsedPayload.data.comment.body,
    eventLabel: "GitHub pull request review comment created",
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
    pullRequestNumber: parsedPayload.data.pull_request.number,
    repositoryFullName: parsedPayload.data.repository.full_name,
    senderLogin: parsedPayload.data.sender?.login,
  });
}

function createObservation(input: {
  body: string | null;
  eventLabel: string;
  eventType: AssociatedResourceEventType;
  pullRequestNumber: number;
  repositoryFullName: string;
  senderLogin?: string | undefined;
}): GitHubAssociatedResourceWebhookObservation {
  const providerResourceId = createGitHubPullRequestProviderResourceId({
    repositoryFullName: input.repositoryFullName,
    pullRequestNumber: input.pullRequestNumber,
  });
  const resourceKind = AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST;
  const authorLine = input.senderLogin === undefined ? [] : [`Author: ${input.senderLogin}`];
  const bodyLines = input.body === null || input.body.length === 0 ? [] : ["", input.body];
  const text = [
    input.eventLabel,
    `Repository: ${input.repositoryFullName}`,
    `Pull request: #${String(input.pullRequestNumber)}`,
    ...authorLine,
    ...bodyLines,
  ].join("\n");

  return {
    eventType: input.eventType,
    providerResourceId,
    resourceKind,
    renderedInput: {
      kind: "github.pull_request.associated_resource_event",
      eventType: input.eventType,
      providerResourceId,
      resourceKind,
      text,
    },
  };
}
