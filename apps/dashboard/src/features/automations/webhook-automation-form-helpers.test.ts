import { describe, expect, it } from "vitest";

import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type { WebhookAutomationFormValues } from "./webhook-automation-form.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-list-helpers.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

const GitHubConnectionId = "conn_github";
const PullRequestOpenedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.pull_request.opened",
});
const IssueCommentCreatedTriggerId = createWebhookAutomationTriggerId({
  connectionId: GitHubConnectionId,
  eventType: "github.issue_comment.created",
});

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: IssueCommentCreatedTriggerId,
    eventType: "github.issue_comment.created",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Issue comment created",
    conversationKeyOptions: [
      {
        id: "issue",
        label: "Per issue thread",
        description: "All matching events for the same issue go to one conversation.",
        template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      },
      {
        id: "repository",
        label: "Per repository",
        description: "All matching events in the same repository go to one conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ],
    parameters: [
      {
        id: "target",
        label: "comment target",
        kind: "enum-select",
        payloadPath: ["issue", "pull_request"],
        matchMode: "exists",
        options: [
          {
            value: "exists",
            label: "pull request",
          },
          {
            value: "not_exists",
            label: "issue",
          },
        ],
        prefix: "in",
        placeholder: "Any comment target",
      },
    ],
  },
  {
    id: PullRequestOpenedTriggerId,
    eventType: "github.pull_request.opened",
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request opened",
    conversationKeyOptions: [
      {
        id: "pull-request",
        label: "Per pull request",
        description: "All matching events for the same pull request go to one conversation.",
        template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
      },
      {
        id: "repository",
        label: "Per repository",
        description: "All matching events in the same repository go to one conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ],
    parameters: [
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
      {
        id: "author",
        label: "author",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["sender", "login"],
        prefix: "by",
        placeholder: "Any author",
      },
    ],
  },
];

const SampleAutomation: WebhookAutomation = {
  id: "aut_123",
  kind: "webhook",
  name: "GitHub pushes to repo triage",
  enabled: true,
  integrationConnectionId: GitHubConnectionId,
  inputTemplate: '{"ref":"{{event.ref}}"}',
  conversationKeyTemplate: "{{event.repository.id}}",
  idempotencyKeyTemplate: null,
  eventTypes: ["push", "pull_request"],
  payloadFilter: {
    op: "eq",
    path: ["action"],
    value: "opened",
  },
  target: {
    id: "target_123",
    sandboxProfileId: "sbp_repo",
    sandboxProfileVersion: null,
  },
  createdAt: "2026-03-11T10:00:00.000Z",
  updatedAt: "2026-03-11T10:05:00.000Z",
};

const BaseFormValues: WebhookAutomationFormValues = {
  name: "Pull request routing",
  sandboxProfileId: "sbp_repo",
  enabled: true,
  inputTemplate: "{}",
  conversationKeyTemplate: "{{event.id}}",
  triggerIds: [PullRequestOpenedTriggerId],
  triggerParameterValues: {},
};

describe("toWebhookAutomationFormValues", () => {
  it("creates empty defaults for create mode", () => {
    expect(toWebhookAutomationFormValues(null)).toEqual({
      name: "",
      sandboxProfileId: "",
      enabled: true,
      inputTemplate: "",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
  });

  it("maps an automation resource into form values", () => {
    expect(toWebhookAutomationFormValues(SampleAutomation)).toEqual({
      name: "GitHub pushes to repo triage",
      sandboxProfileId: "sbp_repo",
      enabled: true,
      inputTemplate: '{"ref":"{{event.ref}}"}',
      conversationKeyTemplate: "{{event.repository.id}}",
      triggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: GitHubConnectionId,
          eventType: "push",
        }),
        createWebhookAutomationTriggerId({
          connectionId: GitHubConnectionId,
          eventType: "pull_request",
        }),
      ],
      triggerParameterValues: {},
    });
  });

  it("hydrates supported trigger parameters out of payload filters", () => {
    expect(
      toWebhookAutomationFormValues(
        {
          ...SampleAutomation,
          eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
          payloadFilter: {
            op: "and",
            filters: [
              {
                op: "eq",
                path: ["repository", "full_name"],
                value: "mistlehq/mistle",
              },
              {
                op: "eq",
                path: ["sender", "login"],
                value: "octocat",
              },
              {
                op: "exists",
                path: ["issue", "pull_request"],
              },
              {
                op: "eq",
                path: ["action"],
                value: "opened",
              },
            ],
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      triggerIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
      triggerParameterValues: {
        [PullRequestOpenedTriggerId]: {
          repository: "mistlehq/mistle",
          author: "octocat",
        },
        [IssueCommentCreatedTriggerId]: {
          target: "exists",
        },
      },
    });
  });
});

describe("validateWebhookAutomationFormValues", () => {
  it("returns field errors for missing required values", () => {
    expect(
      validateWebhookAutomationFormValues(
        {
          name: "",
          sandboxProfileId: "",
          enabled: true,
          inputTemplate: "",
          conversationKeyTemplate: "",
          triggerIds: [],
          triggerParameterValues: {},
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Automation name is required.",
      triggerIds: "Select at least one trigger.",
      sandboxProfileId: "Select a sandbox profile.",
      inputTemplate: "Input template is required.",
      conversationKeyTemplate: "Conversation key template is required.",
    });
  });

  it("rejects triggers from different connections", () => {
    expect(
      validateWebhookAutomationFormValues(
        {
          ...BaseFormValues,
          triggerIds: [
            PullRequestOpenedTriggerId,
            createWebhookAutomationTriggerId({
              connectionId: "conn_stripe",
              eventType: "stripe.payout.failed",
            }),
          ],
        },
        [
          ...GitHubEventOptions,
          {
            id: createWebhookAutomationTriggerId({
              connectionId: "conn_stripe",
              eventType: "stripe.payout.failed",
            }),
            eventType: "stripe.payout.failed",
            connectionId: "conn_stripe",
            connectionLabel: "Stripe Production",
            label: "Payout failed",
          },
        ],
      ),
    ).toEqual({
      triggerIds: "All triggers in one automation must come from the same integration connection.",
    });
  });

  it("rejects unsupported conversation grouping templates for selected triggers", () => {
    expect(
      validateWebhookAutomationFormValues(
        {
          ...BaseFormValues,
          conversationKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          triggerIds: [PullRequestOpenedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      conversationKeyTemplate: "Select a supported conversation grouping.",
    });
  });
});

describe("automation payload transforms", () => {
  it("builds the create payload with a derived connection id", () => {
    expect(
      toCreateWebhookAutomationPayload(
        {
          ...BaseFormValues,
          name: " GitHub pushes to repo triage ",
          triggerIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "GitHub pushes to repo triage",
      enabled: true,
      integrationConnectionId: GitHubConnectionId,
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
      payloadFilter: null,
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });

  it("builds the update payload with nullable optional fields", () => {
    expect(
      toUpdateWebhookAutomationPayload(
        {
          ...BaseFormValues,
          name: "Stripe payouts incident intake",
          enabled: false,
          triggerIds: [PullRequestOpenedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Stripe payouts incident intake",
      enabled: false,
      integrationConnectionId: GitHubConnectionId,
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened"],
      payloadFilter: null,
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });

  it("builds trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookAutomationPayload(
        {
          ...BaseFormValues,
          triggerParameterValues: {
            [PullRequestOpenedTriggerId]: {
              repository: "mistlehq/mistle",
              author: "octocat",
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationConnectionId: GitHubConnectionId,
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened"],
      payloadFilter: {
        op: "and",
        filters: [
          {
            op: "eq",
            path: ["repository", "full_name"],
            value: "mistlehq/mistle",
          },
          {
            op: "eq",
            path: ["sender", "login"],
            value: "octocat",
          },
        ],
      },
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });

  it("builds enum trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookAutomationPayload(
        {
          ...BaseFormValues,
          triggerIds: [IssueCommentCreatedTriggerId],
          triggerParameterValues: {
            [IssueCommentCreatedTriggerId]: {
              target: "exists",
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationConnectionId: GitHubConnectionId,
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.issue_comment.created"],
      payloadFilter: {
        op: "exists",
        path: ["issue", "pull_request"],
      },
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });
});
