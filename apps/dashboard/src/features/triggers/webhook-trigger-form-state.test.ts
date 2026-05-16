import { describe, expect, it } from "vitest";

import { GitHubPullRequestConversationKeyTemplate } from "./webhook-trigger-conversation-key-options.js";
import {
  resolveWebhookTriggerFormPresentation,
  resolveWebhookTriggerFormState,
} from "./webhook-trigger-form-state.js";
import type { WebhookTriggerFormOption } from "./webhook-trigger-form-types.js";
import {
  createWebhookTriggerEventId,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
} from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubWebhookSourceId,
} from "./webhook-trigger-test-fixtures.js";

const PrimaryRepositoryOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: WebhookTriggerWorkspaceRootRepositoryOptionValue,
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
];
describe("resolveWebhookTriggerFormPresentation", () => {
  it("shows create-only and edit-only controls based on mode", () => {
    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      submitLabel: "Create",
      shouldShowTriggerEnabledField: false,
      shouldShowCreateNameField: true,
    });

    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "edit",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      submitLabel: "Save",
      shouldShowTriggerEnabledField: true,
      shouldShowCreateNameField: false,
    });
  });

  it("shows the primary repository field only when a profile and repository options exist", () => {
    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }).shouldShowPrimaryRepositoryField,
    ).toBe(true);

    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "",
          primaryRepositoryId: "",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }).shouldShowPrimaryRepositoryField,
    ).toBe(false);

    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "",
        },
        primaryRepositoryOptions: [],
      }).shouldShowPrimaryRepositoryField,
    ).toBe(false);
  });

  it("resolves selected primary repository path and workspace-root presentation", () => {
    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      selectedPrimaryRepositoryPath: "/root/mistlehq/platform",
      selectedWorkspaceRoot: false,
    });

    expect(
      resolveWebhookTriggerFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: WebhookTriggerWorkspaceRootRepositoryOptionValue,
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      selectedPrimaryRepositoryPath: "workspace root",
      selectedWorkspaceRoot: true,
    });
  });
});

describe("resolveWebhookTriggerFormState", () => {
  it("derives the selected connection id when all selected triggers share a connection", () => {
    const selectedTriggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedEventIds: [selectedTriggerId],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      eventIdsError: undefined,
    });

    expect(state.selectedConnectionId).toBe(GitHubConnectionId);
    expect(state.hasSelectedTrigger).toBe(true);
  });

  it("suppresses the special unavailable-trigger message from the header", () => {
    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [],
      selectedEventIds: ["missing-source::missing.event"],
      conversationKeyTemplate: "",
      eventIdsError: "Event is unavailable for the selected sandbox profile.",
    });

    expect(state.triggerHeaderMessage).toBeUndefined();
  });

  it("keeps other trigger errors visible in the header", () => {
    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      eventIdsError: "Please add an event",
    });

    expect(state.triggerHeaderMessage).toBe("Please add an event");
  });

  it("derives the selected grouping label from the supported conversation key options", () => {
    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      eventIdsError: undefined,
    });

    expect(state.selectedConversationGroupingLabel).toBe("Issue");
  });

  it("derives pull request grouping for pull request events and pull request comments", () => {
    const pullRequestTriggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request.opened",
    });
    const issueCommentTriggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [
        createGithubPullRequestOpenedEventOption(),
        createGithubIssueCommentCreatedEventOption(),
      ],
      selectedEventIds: [pullRequestTriggerId, issueCommentTriggerId],
      conversationKeyTemplate: GitHubPullRequestConversationKeyTemplate,
      eventParameterValues: {
        [issueCommentTriggerId]: {
          target: "exists",
        },
      },
      eventIdsError: undefined,
    });

    expect(state.conversationKeySelectionState.selectedTemplate).toBe(
      GitHubPullRequestConversationKeyTemplate,
    );
    expect(state.selectedConversationGroupingLabel).toBe("Pull request");
  });

  it("builds agent instruction tokens from the selected trigger payload references", () => {
    const state = resolveWebhookTriggerFormState({
      webhookEventOptions: [
        createGithubIssueCommentCreatedEventOption(),
        createGithubPullRequestOpenedEventOption(),
      ],
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      eventIdsError: undefined,
    });

    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.comment.body"),
    ).toBe(true);
    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.pull_request.title"),
    ).toBe(false);
  });
});
