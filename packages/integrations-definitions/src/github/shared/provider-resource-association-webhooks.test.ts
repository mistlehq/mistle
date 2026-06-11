import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { observeGitHubAssociatedResourceFromWebhookEvent } from "./provider-resource-association-webhooks.js";

describe("GitHub associated resource webhook observation", () => {
  it("observes issue comments on pull requests", () => {
    const observed = observeGitHubAssociatedResourceFromWebhookEvent({
      eventType: "github.issue_comment.created",
      payload: {
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 42,
          pull_request: {},
        },
        comment: {
          body: "please handle this",
        },
        sender: {
          login: "octocat",
        },
      },
    });

    expect(observed).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
      providerResourceId: "mistlehq/mistle#42",
      renderedInput: {
        kind: "github.pull_request.associated_resource_event",
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
        providerResourceId: "mistlehq/mistle#42",
        text: [
          "Repository: mistlehq/mistle",
          "Event type: github.issue_comment.created",
          "Author: octocat",
          "",
          "Pull request issue comment:",
          "PR #42",
          "Comment body: please handle this",
        ].join("\n"),
      },
    });
  });

  it("does not observe issue comments that are not on pull requests", () => {
    const observed = observeGitHubAssociatedResourceFromWebhookEvent({
      eventType: "github.issue_comment.created",
      payload: {
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 42,
        },
        comment: {
          body: "plain issue comment",
        },
      },
    });

    expect(observed).toBeNull();
  });

  it("observes pull request reviews and review comments", () => {
    expect(
      observeGitHubAssociatedResourceFromWebhookEvent({
        eventType: "github.pull_request_review.submitted",
        payload: {
          repository: {
            full_name: "mistlehq/mistle",
          },
          pull_request: {
            number: 43,
          },
          review: {
            state: "approved",
            body: "looks good",
          },
          sender: {
            login: "reviewer",
          },
        },
      }),
    ).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
      providerResourceId: "mistlehq/mistle#43",
      renderedInput: {
        kind: "github.pull_request.associated_resource_event",
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
        providerResourceId: "mistlehq/mistle#43",
        text: [
          "Repository: mistlehq/mistle",
          "Event type: github.pull_request_review.submitted",
          "Author: reviewer",
          "",
          "Pull request review submitted:",
          "PR #43",
          "Review state: approved",
          "Review body: looks good",
        ].join("\n"),
      },
    });

    expect(
      observeGitHubAssociatedResourceFromWebhookEvent({
        eventType: "github.pull_request_review_comment.created",
        payload: {
          repository: {
            full_name: "mistlehq/mistle",
          },
          pull_request: {
            number: 44,
          },
          comment: {
            body: "review line note",
            path: "packages/example.ts",
            line: 12,
          },
          sender: {
            login: "octocat",
          },
        },
      }),
    ).toEqual({
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
      providerResourceId: "mistlehq/mistle#44",
      renderedInput: {
        kind: "github.pull_request.associated_resource_event",
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED,
        providerResourceId: "mistlehq/mistle#44",
        text: [
          "Repository: mistlehq/mistle",
          "Event type: github.pull_request_review_comment.created",
          "Author: octocat",
          "",
          "Pull request review comment:",
          "PR #44",
          "File: packages/example.ts",
          "Line: 12",
          "Comment body: review line note",
        ].join("\n"),
      },
    });
  });
});
