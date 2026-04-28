import { describe, expect, it } from "vitest";

import {
  resolveWebhookAutomationFormPresentation,
  resolveWebhookAutomationFormState,
} from "./webhook-automation-form-state.js";
import type { WebhookAutomationFormOption } from "./webhook-automation-form-types.js";
import {
  createWebhookAutomationTriggerId,
  WebhookAutomationWorkspaceRootRepositoryOptionValue,
} from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";

const PrimaryRepositoryOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: WebhookAutomationWorkspaceRootRepositoryOptionValue,
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
];

describe("resolveWebhookAutomationFormPresentation", () => {
  it("shows create-only and edit-only controls based on mode", () => {
    expect(
      resolveWebhookAutomationFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      submitLabel: "Create",
      shouldShowAutomationEnabledField: false,
      shouldShowCreateNameField: true,
    });

    expect(
      resolveWebhookAutomationFormPresentation({
        mode: "edit",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      submitLabel: "Save",
      shouldShowAutomationEnabledField: true,
      shouldShowCreateNameField: false,
    });
  });

  it("shows the primary repository field only when a profile and repository options exist", () => {
    expect(
      resolveWebhookAutomationFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: "mistlehq/platform",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }).shouldShowPrimaryRepositoryField,
    ).toBe(true);

    expect(
      resolveWebhookAutomationFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "",
          primaryRepositoryId: "",
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }).shouldShowPrimaryRepositoryField,
    ).toBe(false);

    expect(
      resolveWebhookAutomationFormPresentation({
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
      resolveWebhookAutomationFormPresentation({
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
      resolveWebhookAutomationFormPresentation({
        mode: "create",
        values: {
          sandboxProfileId: "sbp_repo",
          primaryRepositoryId: WebhookAutomationWorkspaceRootRepositoryOptionValue,
        },
        primaryRepositoryOptions: PrimaryRepositoryOptions,
      }),
    ).toMatchObject({
      selectedPrimaryRepositoryPath: "workspace root",
      selectedWorkspaceRoot: true,
    });
  });
});

describe("resolveWebhookAutomationFormState", () => {
  it("derives the selected connection id when all selected triggers share a connection", () => {
    const selectedTriggerId = createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [selectedTriggerId],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      triggerIdsError: undefined,
    });

    expect(state.selectedConnectionId).toBe(GitHubConnectionId);
    expect(state.hasSelectedTrigger).toBe(true);
  });

  it("suppresses the special unavailable-trigger message from the header", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [],
      selectedTriggerIds: ["missing-source::missing.event"],
      conversationKeyTemplate: "",
      triggerIdsError: "Trigger is unavailable for the selected sandbox profile.",
    });

    expect(state.triggerHeaderMessage).toBeUndefined();
  });

  it("keeps other trigger errors visible in the header", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      triggerIdsError: "Please add a trigger",
    });

    expect(state.triggerHeaderMessage).toBe("Please add a trigger");
  });

  it("derives the selected grouping label from the supported conversation key options", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [createGithubIssueCommentCreatedEventOption()],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      triggerIdsError: undefined,
    });

    expect(state.selectedConversationGroupingLabel).toBe("Issue");
  });

  it("builds agent instruction tokens from the selected trigger payload references", () => {
    const state = resolveWebhookAutomationFormState({
      webhookEventOptions: [
        createGithubIssueCommentCreatedEventOption(),
        createGithubPullRequestOpenedEventOption(),
      ],
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      conversationKeyTemplate: "",
      triggerIdsError: undefined,
    });

    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.comment.body"),
    ).toBe(true);
    expect(
      state.agentInstructionTokens.some((token) => token.path === "payload.pull_request.title"),
    ).toBe(false);
  });
});
