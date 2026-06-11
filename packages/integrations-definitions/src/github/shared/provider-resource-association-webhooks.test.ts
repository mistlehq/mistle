import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  isSelfAuthoredGitHubAssociatedResourceEvent,
  observeGitHubAssociatedResourceFromWebhookEvent,
} from "./provider-resource-association-webhooks.js";

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
      actor: {
        handle: "octocat",
      },
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
      actor: {
        handle: "reviewer",
      },
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
      actor: {
        handle: "octocat",
      },
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

  it("identifies GitHub App bot events as self-authored for app installation connections", () => {
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
          body: "comment from the app",
        },
        sender: {
          login: "mistle-github-app[bot]",
        },
      },
    });
    if (observed === null) {
      throw new Error("Expected GitHub pull request issue comment to be observed.");
    }

    expect(
      isSelfAuthoredGitHubAssociatedResourceEvent({
        connection: {
          config: {
            connection_method: "github-app-installation",
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.example",
            installation_id: "98765",
          },
        },
        observation: observed,
      }),
    ).toBe(true);
  });

  it("does not treat linked user and unknown actor events as self-authored", () => {
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
          body: "comment from a linked user",
        },
        sender: {
          login: "octocat",
        },
      },
    });
    if (observed === null) {
      throw new Error("Expected GitHub pull request issue comment to be observed.");
    }

    expect(
      isSelfAuthoredGitHubAssociatedResourceEvent({
        connection: {
          config: {
            connection_method: "github-app-installation",
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.example",
            installation_id: "98765",
          },
        },
        observation: observed,
      }),
    ).toBe(false);

    expect(
      isSelfAuthoredGitHubAssociatedResourceEvent({
        connection: {
          config: {
            connection_method: "api-key",
          },
        },
        observation: {
          ...observed,
          actor: undefined,
        },
      }),
    ).toBe(false);
  });
});
