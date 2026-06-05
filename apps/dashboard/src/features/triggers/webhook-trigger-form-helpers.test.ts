import { describe, expect, it } from "vitest";

import { GitHubPullRequestConversationKeyTemplate } from "./webhook-trigger-conversation-key-options.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import {
  toCreateWebhookTriggerPayload,
  toUpdateWebhookTriggerPayload,
  toWebhookTriggerFormValues,
  validateWebhookTriggerFormValues,
} from "./webhook-trigger-form-helpers.js";
import type { WebhookTriggerFormValues } from "./webhook-trigger-form-types.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
import {
  createWebhookTriggerEventId,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
} from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubWebhookSourceId,
} from "./webhook-trigger-test-fixtures.js";
import type { WebhookTrigger } from "./webhook-triggers-types.js";

const GitHubConnectionId = "conn_github";
const SlackConnectionId = "conn_slack";
const SlackWebhookSourceId = "iws_slack";
const StripeWebhookSourceId = "iws_stripe";
const PullRequestOpenedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.opened",
});
const IssueCommentCreatedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.issue_comment.created",
});
const PullRequestReviewRequestedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.review_requested",
});
const SlackAppMentionTriggerId = createWebhookTriggerEventId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
});

function isRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value,
  };
}

function isNotRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
    value,
  };
}

function containsTokenRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
    value,
  };
}

function existsRule() {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
    value: "exists",
  };
}

const GitHubEventOptions: readonly WebhookTriggerEventOption[] = [
  createGithubIssueCommentCreatedEventOption({
    id: IssueCommentCreatedTriggerId,
    integrationWebhookSourceId: GitHubWebhookSourceId,
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
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
  }),
  createGithubPullRequestOpenedEventOption({
    id: PullRequestOpenedTriggerId,
    integrationWebhookSourceId: GitHubWebhookSourceId,
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    conversationKeyOptions: [
      {
        id: "pull-request",
        label: "Pull request",
        description: "Events from the same pull request go to the same conversation.",
        template: GitHubPullRequestConversationKeyTemplate,
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
  }),
  {
    id: PullRequestReviewRequestedTriggerId,
    eventType: "github.pull_request.review_requested",
    integrationWebhookSourceId: GitHubWebhookSourceId,
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
    label: "Pull request review requested",
    parameters: [
      {
        id: "requestedReviewer",
        label: "requested reviewer",
        kind: "resource-select",
        resourceKind: "user",
        payloadPath: ["requested_reviewer", "login"],
        prefix: "for",
      },
      {
        id: "requestedTeam",
        label: "requested GitHub team",
        kind: "string",
        payloadPath: ["requested_team", "slug"],
        prefix: "for team",
        placeholder: "Any GitHub team slug",
      },
    ],
  },
];

const SlackAppMentionEventOption: WebhookTriggerEventOption = {
  id: SlackAppMentionTriggerId,
  eventType: "slack:app_mention",
  integrationWebhookSourceId: SlackWebhookSourceId,
  connectionId: SlackConnectionId,
  connectionLabel: "Slack Engineering",
  label: "App mention",
  logoKey: "slack",
  conversationKeyOptions: [
    {
      id: "channel",
      label: "Channel",
      description: "Events from the same Slack channel go to the same conversation.",
      template: "slack:channel:{{payload.event.channel}}",
    },
  ],
  parameters: [
    {
      id: "channel",
      label: "channel",
      kind: "resource-select",
      resourceKind: "channel",
      payloadPath: ["event", "channel"],
      prefix: "in",
    },
  ],
};

const SampleTrigger: WebhookTrigger = {
  id: "trg_123",
  kind: "webhook",
  name: "GitHub pushes to repo triage",
  enabled: true,
  integrationWebhookSourceId: GitHubWebhookSourceId,
  inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
  instructions: "Use the repository conventions.",
  conversationKeyTemplate: "{{event.repository.id}}",
  idempotencyKeyTemplate: null,
  eventTypes: ["push", "pull_request"],
  payloadFilter: {
    pull_request: {
      op: "eq",
      path: ["action"],
      value: "opened",
    },
  },
  target: {
    id: "target_123",
    sandboxProfileId: "sbp_repo",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/platform",
  },
  createdAt: "2026-03-11T10:00:00.000Z",
  updatedAt: "2026-03-11T10:05:00.000Z",
};

const BaseFormValues: WebhookTriggerFormValues = {
  name: "Pull request routing",
  sandboxProfileId: "sbp_repo",
  primaryRepositoryId: "",
  enabled: true,
  inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
  instructions: "",
  conversationKeyTemplate: "{{event.id}}",
  eventIds: [PullRequestOpenedTriggerId],
  eventParameterRules: {},
  remainingPayloadFilter: null,
};

describe("toWebhookTriggerFormValues", () => {
  it("creates defaults for create mode", () => {
    expect(toWebhookTriggerFormValues(null)).toEqual({
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      inputTemplate: DefaultWebhookTriggerMessageTemplate,
      instructions: "",
      conversationKeyTemplate: "",
      eventIds: [],
      eventParameterRules: {},
      remainingPayloadFilter: null,
    });
  });

  it("maps a trigger resource into form values", () => {
    expect(toWebhookTriggerFormValues(SampleTrigger)).toEqual({
      name: "GitHub pushes to repo triage",
      sandboxProfileId: "sbp_repo",
      primaryRepositoryId: "mistlehq/platform",
      enabled: true,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: "Use the repository conventions.",
      conversationKeyTemplate: "{{event.repository.id}}",
      eventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "push",
        }),
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "pull_request",
        }),
      ],
      eventParameterRules: {},
      remainingPayloadFilter: {
        pull_request: {
          op: "eq",
          path: ["action"],
          value: "opened",
        },
      },
    });
  });

  it("accepts custom stored templates", () => {
    expect(
      toWebhookTriggerFormValues({
        ...SampleTrigger,
        inputTemplate: "Handle {{payload.comment.body}}",
      }),
    ).toMatchObject({
      inputTemplate: "Handle {{payload.comment.body}}",
      instructions: "Use the repository conventions.",
    });
  });

  it("hydrates supported trigger parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
          payloadFilter: {
            "github.pull_request.opened": {
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
            "github.issue_comment.created": {
              op: "exists",
              path: ["issue", "pull_request"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
      eventParameterRules: {
        [PullRequestOpenedTriggerId]: {
          repository: isRule("mistlehq/mistle"),
          author: isRule("octocat"),
        },
        [IssueCommentCreatedTriggerId]: {
          target: existsRule(),
        },
      },
    });
  });

  it("hydrates negative equality trigger parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          eventTypes: ["github.pull_request.opened"],
          payloadFilter: {
            "github.pull_request.opened": {
              op: "neq",
              path: ["sender", "login"],
              value: "dependabot",
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestOpenedTriggerId]: {
          author: isNotRule("dependabot"),
        },
      },
    });
  });

  it("hydrates guarded GitHub requested reviewer exclusion filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          eventTypes: ["github.pull_request.review_requested"],
          payloadFilter: {
            "github.pull_request.review_requested": {
              op: "and",
              filters: [
                {
                  op: "exists",
                  path: ["requested_reviewer", "login"],
                },
                {
                  op: "neq",
                  path: ["requested_reviewer", "login"],
                  value: "octocat",
                },
              ],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedTriggerId]: {
          requestedReviewer: isNotRule("octocat"),
        },
      },
    });
  });

  it("preserves standalone GitHub requested reviewer exists filters as advanced payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          eventTypes: ["github.pull_request.review_requested"],
          payloadFilter: {
            "github.pull_request.review_requested": {
              op: "exists",
              path: ["requested_reviewer", "login"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {},
      remainingPayloadFilter: {
        "github.pull_request.review_requested": {
          op: "exists",
          path: ["requested_reviewer", "login"],
        },
      },
    });
  });

  it("merges preserved advanced payload filters when building trigger payloads", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          remainingPayloadFilter: {
            "github.pull_request.opened": {
              op: "exists",
              path: ["pull_request", "draft"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      payloadFilter: {
        "github.pull_request.opened": {
          op: "exists",
          path: ["pull_request", "draft"],
        },
      },
    });
  });

  it("drops preserved advanced payload filters for events that are no longer selected", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [IssueCommentCreatedTriggerId],
          remainingPayloadFilter: {
            "github.pull_request.opened": {
              op: "exists",
              path: ["pull_request", "draft"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventTypes: ["github.issue_comment.created"],
      payloadFilter: null,
    });
  });

  it("hydrates Slack app mention channel parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          integrationWebhookSourceId: SlackWebhookSourceId,
          eventTypes: ["slack:app_mention"],
          payloadFilter: {
            "slack:app_mention": {
              op: "eq",
              path: ["event", "channel"],
              value: "C12345678",
            },
          },
        },
        [SlackAppMentionEventOption],
      ),
    ).toMatchObject({
      eventIds: [SlackAppMentionTriggerId],
      eventParameterRules: {
        [SlackAppMentionTriggerId]: {
          channel: isRule("C12345678"),
        },
      },
    });
  });

  it("hydrates explicit invocation trigger parameters out of contains_token filters", () => {
    expect(
      toWebhookTriggerFormValues(
        {
          ...SampleTrigger,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: {
            "github.issue_comment.created": {
              op: "contains_token",
              path: ["comment", "body"],
              value: "@mistlebot",
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventIds: [IssueCommentCreatedTriggerId],
      eventParameterRules: {
        [IssueCommentCreatedTriggerId]: {
          invocationToken: containsTokenRule("@mistlebot"),
        },
      },
    });
  });
});

describe("validateWebhookTriggerFormValues", () => {
  it("returns field errors for missing required values", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          name: "",
          sandboxProfileId: "",
          primaryRepositoryId: "",
          enabled: true,
          inputTemplate: "",
          instructions: "",
          conversationKeyTemplate: "",
          eventIds: [],
          eventParameterRules: {},
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Trigger name is required.",
      eventIds: "Please add an event",
      sandboxProfileId: "Select a sandbox profile.",
      inputTemplate: "User message is required.",
      conversationKeyTemplate: "Conversation key template is required.",
    });
  });

  it("rejects triggers from different connections", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          eventIds: [
            PullRequestOpenedTriggerId,
            createWebhookTriggerEventId({
              webhookSourceId: StripeWebhookSourceId,
              eventType: "stripe.payout.failed",
            }),
          ],
        },
        [
          ...GitHubEventOptions,
          {
            id: createWebhookTriggerEventId({
              webhookSourceId: StripeWebhookSourceId,
              eventType: "stripe.payout.failed",
            }),
            eventType: "stripe.payout.failed",
            integrationWebhookSourceId: StripeWebhookSourceId,
            connectionId: "conn_stripe",
            connectionLabel: "Stripe Production",
            label: "Payout failed",
          },
        ],
      ),
    ).toEqual({
      eventIds: "All events in one trigger must come from the same integration connection.",
    });
  });

  it("rejects unsupported conversation grouping templates for selected triggers", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          conversationKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          eventIds: [PullRequestOpenedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      conversationKeyTemplate: "Select a supported conversation grouping.",
    });
  });

  it("rejects unavailable triggers before save", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          eventIds: [PullRequestOpenedTriggerId],
        },
        [
          createGithubPullRequestOpenedEventOption({
            id: PullRequestOpenedTriggerId,
            integrationWebhookSourceId: GitHubWebhookSourceId,
            connectionId: GitHubConnectionId,
            connectionLabel: "GitHub Engineering",
            availability: "wrong_profile",
            description: "Event is unavailable for the selected sandbox profile.",
          }),
        ],
      ),
    ).toEqual({
      eventIds: "Event is unavailable for the selected sandbox profile.",
    });
  });

  it("accepts the seeded input template without requiring customization", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          inputTemplate: DefaultWebhookTriggerMessageTemplate,
          conversationKeyTemplate: GitHubPullRequestConversationKeyTemplate,
        },
        GitHubEventOptions,
      ),
    ).toEqual({});
  });

  it("accepts pull request grouping for pull request events and filtered pull request comments", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          conversationKeyTemplate: GitHubPullRequestConversationKeyTemplate,
          eventIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
          eventParameterRules: {
            [IssueCommentCreatedTriggerId]: {
              invocationToken: containsTokenRule("pr-review"),
              target: existsRule(),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({});
  });
});

describe("trigger payload transforms", () => {
  it("builds the create payload with a derived webhook source id", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          name: " GitHub pushes to repo triage ",
          eventIds: [PullRequestOpenedTriggerId, IssueCommentCreatedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "GitHub pushes to repo triage",
      enabled: true,
      integrationWebhookSourceId: GitHubWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: null,
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
      payloadFilter: null,
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("builds the update payload with nullable optional fields", () => {
    expect(
      toUpdateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          name: "Stripe payouts incident intake",
          enabled: false,
          eventIds: [PullRequestOpenedTriggerId],
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Stripe payouts incident intake",
      enabled: false,
      integrationWebhookSourceId: GitHubWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: null,
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened"],
      payloadFilter: null,
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("maps a selected primary repository into the submission payload", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          primaryRepositoryId: "mistlehq/platform",
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: "mistlehq/platform",
      },
    });
  });

  it("maps the workspace-root selection to a null primary repository id", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          primaryRepositoryId: WebhookTriggerWorkspaceRootRepositoryOptionValue,
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("builds trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventParameterRules: {
            [PullRequestOpenedTriggerId]: {
              repository: isRule("mistlehq/mistle"),
              author: isRule("octocat"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationWebhookSourceId: GitHubWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: null,
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened"],
      payloadFilter: {
        "github.pull_request.opened": {
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
      },
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("builds negative trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventParameterRules: {
            [PullRequestOpenedTriggerId]: {
              author: isNotRule("dependabot"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      payloadFilter: {
        "github.pull_request.opened": {
          op: "neq",
          path: ["sender", "login"],
          value: "dependabot",
        },
      },
    });
  });

  it("does not combine GitHub requested reviewer and team parameters as an impossible AND filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedTriggerId],
          eventParameterRules: {
            [PullRequestReviewRequestedTriggerId]: {
              requestedReviewer: isRule("mistle-agent[bot]"),
              requestedTeam: isRule("platform"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventTypes: ["github.pull_request.review_requested"],
      payloadFilter: {
        "github.pull_request.review_requested": {
          op: "eq",
          path: ["requested_reviewer", "login"],
          value: "mistle-agent[bot]",
        },
      },
    });
  });

  it("guards negated GitHub requested reviewer filters against team review requests", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedTriggerId],
          eventParameterRules: {
            [PullRequestReviewRequestedTriggerId]: {
              requestedReviewer: isNotRule("octocat"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      payloadFilter: {
        "github.pull_request.review_requested": {
          op: "and",
          filters: [
            {
              op: "exists",
              path: ["requested_reviewer", "login"],
            },
            {
              op: "neq",
              path: ["requested_reviewer", "login"],
              value: "octocat",
            },
          ],
        },
      },
    });
  });

  it("omits trigger parameter filters with blank values from the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventParameterRules: {
            [PullRequestOpenedTriggerId]: {
              author: isNotRule(""),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      payloadFilter: null,
    });
  });

  it("builds Slack app mention channel parameters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
          eventIds: [SlackAppMentionTriggerId],
          eventParameterRules: {
            [SlackAppMentionTriggerId]: {
              channel: isRule("C12345678"),
            },
          },
        },
        [SlackAppMentionEventOption],
      ),
    ).toMatchObject({
      name: "Pull request routing",
      enabled: true,
      integrationWebhookSourceId: SlackWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["slack:app_mention"],
      payloadFilter: {
        "slack:app_mention": {
          op: "eq",
          path: ["event", "channel"],
          value: "C12345678",
        },
      },
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("builds enum trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [IssueCommentCreatedTriggerId],
          eventParameterRules: {
            [IssueCommentCreatedTriggerId]: {
              target: existsRule(),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationWebhookSourceId: GitHubWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: null,
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.issue_comment.created"],
      payloadFilter: {
        "github.issue_comment.created": {
          op: "exists",
          path: ["issue", "pull_request"],
        },
      },
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("builds explicit invocation trigger parameters into contains_token payload filters", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [IssueCommentCreatedTriggerId],
          eventParameterRules: {
            [IssueCommentCreatedTriggerId]: {
              invocationToken: containsTokenRule("@mistlebot"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationWebhookSourceId: GitHubWebhookSourceId,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: null,
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.issue_comment.created"],
      payloadFilter: {
        "github.issue_comment.created": {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
      },
      target: {
        sandboxProfileId: "sbp_repo",
        primaryRepositoryId: null,
      },
    });
  });

  it("maps non-empty trigger instructions into the submission payload", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          instructions: " Keep replies under 5 lines. ",
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      instructions: "Keep replies under 5 lines.",
    });
  });
});
