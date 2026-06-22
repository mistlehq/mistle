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
  createWebhookTriggerEventConditionId,
  createWebhookTriggerEventId,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
} from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  createGithubPullRequestReviewRequestedEventOption,
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
const SlackMessageTriggerId = createWebhookTriggerEventId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:message",
});
const PushConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: createWebhookTriggerEventId({
    webhookSourceId: GitHubWebhookSourceId,
    eventType: "push",
  }),
  index: 0,
});
const PullRequestConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: PullRequestOpenedTriggerId,
  index: 0,
});
const PullRequestConditionId1 = createWebhookTriggerEventConditionId({
  eventOptionId: createWebhookTriggerEventId({
    webhookSourceId: GitHubWebhookSourceId,
    eventType: "pull_request",
  }),
  index: 1,
});
const IssueCommentConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: IssueCommentCreatedTriggerId,
  index: 0,
});
const IssueCommentConditionId1 = createWebhookTriggerEventConditionId({
  eventOptionId: IssueCommentCreatedTriggerId,
  index: 1,
});
const PullRequestReviewRequestedConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: PullRequestReviewRequestedTriggerId,
  index: 0,
});
const SlackAppMentionConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: SlackAppMentionTriggerId,
  index: 0,
});
const SlackMessageConditionId0 = createWebhookTriggerEventConditionId({
  eventOptionId: SlackMessageTriggerId,
  index: 0,
});

function isRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value,
  };
}

function isAnyOfRule(values: readonly string[]) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS,
    value: "",
    values: [...values],
  };
}

function isNotRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
    value,
  };
}

function isNotAnyOfRule(values: readonly string[]) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
    value: "",
    values: [...values],
  };
}

function containsTokenRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
    value,
  };
}

function containsRule(value: string) {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.CONTAINS,
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
  }),
  createGithubPullRequestReviewRequestedEventOption({
    id: PullRequestReviewRequestedTriggerId,
    integrationWebhookSourceId: GitHubWebhookSourceId,
    connectionId: GitHubConnectionId,
    connectionLabel: "GitHub Engineering",
  }),
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
      multiValue: true,
    },
  ],
};

const SlackMessageEventOption: WebhookTriggerEventOption = {
  id: SlackMessageTriggerId,
  eventType: "slack:message",
  integrationWebhookSourceId: SlackWebhookSourceId,
  connectionId: SlackConnectionId,
  connectionLabel: "Slack Engineering",
  label: "Message",
  logoKey: "slack",
  parameters: [
    {
      id: "invocationToken",
      label: "invocation token",
      kind: "string",
      payloadPath: ["event", "text"],
      matchMode: "contains_token",
      controlVariant: "invocation-token",
    },
    {
      id: "messageText",
      label: "message text",
      kind: "string",
      payloadPath: ["event", "text"],
      matchMode: "contains",
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
  eventConditions: [
    { eventType: "push" },
    {
      eventType: "pull_request",
      payloadFilter: {
        op: "eq",
        path: ["action"],
        value: "opened",
      },
    },
  ],
  target: {
    id: "target_123",
    sandboxProfileId: "sbp_repo",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "mistlehq/platform",
  },
  createdAt: "2026-03-11T10:00:00.000Z",
  updatedAt: "2026-03-11T10:05:00.000Z",
};

function withWebhookTriggerEventConditions(input: {
  trigger: WebhookTrigger;
  eventConditions: WebhookTrigger["eventConditions"];
  integrationWebhookSourceId?: string;
}): WebhookTrigger {
  return {
    ...input.trigger,
    ...(input.integrationWebhookSourceId === undefined
      ? {}
      : { integrationWebhookSourceId: input.integrationWebhookSourceId }),
    eventConditions: input.eventConditions,
  };
}

const BaseFormValues: WebhookTriggerFormValues = {
  name: "Pull request routing",
  sandboxProfileId: "sbp_repo",
  primaryRepositoryId: "",
  enabled: true,
  inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
  instructions: "",
  conversationKeyTemplate: "{{event.id}}",
  eventIds: [PullRequestConditionId0],
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

  it("maps a webhook trigger into form values", () => {
    expect(toWebhookTriggerFormValues(SampleTrigger)).toEqual({
      name: "GitHub pushes to repo triage",
      sandboxProfileId: "sbp_repo",
      primaryRepositoryId: "mistlehq/platform",
      enabled: true,
      inputTemplate: "Please write a review of the changes made.\n\nPayload:\n{{payload}}",
      instructions: "Use the repository conventions.",
      conversationKeyTemplate: "{{event.repository.id}}",
      eventIds: [PushConditionId0, PullRequestConditionId1],
      eventParameterRules: {},
      remainingPayloadFilter: {
        [PullRequestConditionId1]: {
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
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
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
            },
            {
              eventType: "github.issue_comment.created",
              payloadFilter: {
                op: "exists",
                path: ["issue", "pull_request"],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventIds: [PullRequestConditionId0, IssueCommentConditionId1],
      eventParameterRules: {
        [PullRequestConditionId0]: {
          repository: isAnyOfRule(["mistlehq/mistle"]),
          author: isAnyOfRule(["octocat"]),
        },
        [IssueCommentConditionId1]: {
          target: existsRule(),
        },
      },
    });
  });

  it("hydrates negative equality trigger parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
              payloadFilter: {
                op: "neq",
                path: ["sender", "login"],
                value: "dependabot",
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestConditionId0]: {
          author: isNotAnyOfRule(["dependabot"]),
        },
      },
    });
  });

  it("hydrates repeated negative multi-value trigger parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
              payloadFilter: {
                op: "and",
                filters: [
                  {
                    op: "neq",
                    path: ["sender", "login"],
                    value: "dependabot",
                  },
                  {
                    op: "neq",
                    path: ["sender", "login"],
                    value: "renovate",
                  },
                ],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestConditionId0]: {
          author: isNotAnyOfRule(["dependabot", "renovate"]),
        },
      },
    });
  });

  it("hydrates GitHub bot actor filters out of sender login payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
              payloadFilter: {
                op: "eq",
                path: ["sender", "login"],
                value: "dependabot[bot]",
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestConditionId0]: {
          botActor: isAnyOfRule(["dependabot[bot]"]),
        },
      },
    });
  });

  it("hydrates GitHub bot actor filters out of sender login in-filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
              payloadFilter: {
                op: "in",
                path: ["sender", "login"],
                values: ["dependabot[bot]", "renovate[bot]"],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestConditionId0]: {
          botActor: isAnyOfRule(["dependabot[bot]", "renovate[bot]"]),
        },
      },
      remainingPayloadFilter: null,
    });
  });

  it("preserves mixed GitHub actor in-filters as advanced payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.opened",
              payloadFilter: {
                op: "in",
                path: ["sender", "login"],
                values: ["octocat", "dependabot[bot]"],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toEqual(
      expect.objectContaining({
        eventParameterRules: {},
        remainingPayloadFilter: {
          [PullRequestConditionId0]: {
            op: "in",
            path: ["sender", "login"],
            values: ["octocat", "dependabot[bot]"],
          },
        },
      }),
    );
  });

  it("hydrates guarded GitHub requested reviewer exclusion filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
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
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId0]: {
          requestedReviewer: isNotAnyOfRule(["octocat"]),
        },
      },
    });
  });

  it("hydrates GitHub requested bot filters out of requested reviewer login payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
                op: "eq",
                path: ["requested_reviewer", "login"],
                value: "mistle-agent[bot]",
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId0]: {
          requestedBot: isAnyOfRule(["mistle-agent[bot]"]),
        },
      },
    });
  });

  it("hydrates GitHub requested bot filters out of requested reviewer login in-filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
                op: "in",
                path: ["requested_reviewer", "login"],
                values: ["mistle-agent[bot]", "mistle-reviewer[bot]"],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId0]: {
          requestedBot: isAnyOfRule(["mistle-agent[bot]", "mistle-reviewer[bot]"]),
        },
      },
      remainingPayloadFilter: null,
    });
  });

  it("hydrates guarded GitHub requested bot exclusion filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
                op: "and",
                filters: [
                  {
                    op: "exists",
                    path: ["requested_reviewer", "login"],
                  },
                  {
                    op: "neq",
                    path: ["requested_reviewer", "login"],
                    value: "mistle-agent[bot]",
                  },
                ],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId0]: {
          requestedBot: isNotAnyOfRule(["mistle-agent[bot]"]),
        },
      },
    });
  });

  it("hydrates guarded reviewer exclusions from payload filters merged with advanced filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
                op: "and",
                filters: [
                  {
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
                  {
                    op: "eq",
                    path: ["pull_request", "draft"],
                    value: "false",
                  },
                ],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId0]: {
          requestedReviewer: isNotAnyOfRule(["octocat"]),
        },
      },
      remainingPayloadFilter: {
        [PullRequestReviewRequestedConditionId0]: {
          op: "eq",
          path: ["pull_request", "draft"],
          value: "false",
        },
      },
    });
  });

  it("preserves standalone GitHub requested reviewer exists filters as advanced payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.pull_request.review_requested",
              payloadFilter: {
                op: "exists",
                path: ["requested_reviewer", "login"],
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventParameterRules: {},
      remainingPayloadFilter: {
        [PullRequestReviewRequestedConditionId0]: {
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
            [PullRequestConditionId0]: {
              op: "exists",
              path: ["pull_request", "draft"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
          payloadFilter: {
            op: "exists",
            path: ["pull_request", "draft"],
          },
        },
      ],
    });
  });

  it("drops preserved advanced payload filters for events that are no longer selected", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [IssueCommentConditionId0],
          remainingPayloadFilter: {
            [PullRequestConditionId0]: {
              op: "exists",
              path: ["pull_request", "draft"],
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.issue_comment.created",
        },
      ],
    });
  });

  it("hydrates Slack app mention channel parameters out of payload filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          integrationWebhookSourceId: SlackWebhookSourceId,
          eventConditions: [
            {
              eventType: "slack:app_mention",
              payloadFilter: {
                op: "eq",
                path: ["event", "channel"],
                value: "C12345678",
              },
            },
          ],
        }),
        [SlackAppMentionEventOption],
      ),
    ).toMatchObject({
      eventIds: [SlackAppMentionConditionId0],
      eventParameterRules: {
        [SlackAppMentionConditionId0]: {
          channel: isAnyOfRule(["C12345678"]),
        },
      },
    });
  });

  it("round-trips migrated Slack single-channel filters through the multi-value channel parameter", () => {
    const formValues = toWebhookTriggerFormValues(
      withWebhookTriggerEventConditions({
        trigger: SampleTrigger,
        integrationWebhookSourceId: SlackWebhookSourceId,
        eventConditions: [
          {
            eventType: "slack:app_mention",
            payloadFilter: {
              op: "eq",
              path: ["event", "channel"],
              value: "C12345678",
            },
          },
        ],
      }),
      [SlackAppMentionEventOption],
    );

    expect(toCreateWebhookTriggerPayload(formValues, [SlackAppMentionEventOption])).toMatchObject({
      eventConditions: [
        {
          eventType: "slack:app_mention",
          payloadFilter: {
            op: "in",
            path: ["event", "channel"],
            values: ["C12345678"],
          },
        },
      ],
    });
  });

  it("hydrates Slack message text and invocation filters that share the event text path", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          integrationWebhookSourceId: SlackWebhookSourceId,
          eventConditions: [
            {
              eventType: "slack:message",
              payloadFilter: {
                op: "and",
                filters: [
                  {
                    op: "contains",
                    path: ["event", "text"],
                    value: "deployment failed",
                  },
                  {
                    op: "contains_token",
                    path: ["event", "text"],
                    value: "@mistle",
                  },
                ],
              },
            },
          ],
        }),
        [SlackMessageEventOption],
      ),
    ).toMatchObject({
      eventIds: [SlackMessageConditionId0],
      eventParameterRules: {
        [SlackMessageConditionId0]: {
          messageText: containsRule("deployment failed"),
          invocationToken: containsTokenRule("@mistle"),
        },
      },
    });
  });

  it("hydrates explicit invocation trigger parameters out of contains_token filters", () => {
    expect(
      toWebhookTriggerFormValues(
        withWebhookTriggerEventConditions({
          trigger: SampleTrigger,
          eventConditions: [
            {
              eventType: "github.issue_comment.created",
              payloadFilter: {
                op: "contains_token",
                path: ["comment", "body"],
                value: "@mistlebot",
              },
            },
          ],
        }),
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventIds: [IssueCommentConditionId0],
      eventParameterRules: {
        [IssueCommentConditionId0]: {
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
          eventIds: [PullRequestConditionId0],
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
          eventIds: [PullRequestConditionId0],
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
          eventIds: [PullRequestConditionId0, IssueCommentConditionId1],
          eventParameterRules: {
            [IssueCommentConditionId1]: {
              invocationToken: containsTokenRule("pr-review"),
              target: existsRule(),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toEqual({});
  });

  it("rejects invocation token filters that contain whitespace", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          eventIds: [SlackMessageConditionId0],
          eventParameterRules: {
            [SlackMessageConditionId0]: {
              invocationToken: containsTokenRule("JIRA ticket created:"),
            },
          },
        },
        [SlackMessageEventOption],
      ),
    ).toEqual({
      eventParameterRules: {
        triggerId: SlackMessageConditionId0,
        parameterId: "invocationToken",
        message: "Invocation token filters cannot contain whitespace.",
      },
    });
  });

  it("accepts invocation token filters without whitespace", () => {
    expect(
      validateWebhookTriggerFormValues(
        {
          ...BaseFormValues,
          eventIds: [SlackMessageConditionId0],
          eventParameterRules: {
            [SlackMessageConditionId0]: {
              invocationToken: containsTokenRule("jira-ticket-created"),
            },
          },
        },
        [SlackMessageEventOption],
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
          eventIds: [PullRequestConditionId0, IssueCommentConditionId1],
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
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
        },
        {
          eventType: "github.issue_comment.created",
        },
      ],
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
          eventIds: [PullRequestConditionId0],
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
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
        },
      ],
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
            [PullRequestConditionId0]: {
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
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
          payloadFilter: {
            op: "and",
            filters: [
              {
                op: "in",
                path: ["repository", "full_name"],
                values: ["mistlehq/mistle"],
              },
              {
                op: "in",
                path: ["sender", "login"],
                values: ["octocat"],
              },
            ],
          },
        },
      ],
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
            [PullRequestConditionId0]: {
              author: isNotRule("dependabot"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
          payloadFilter: {
            op: "neq",
            path: ["sender", "login"],
            value: "dependabot",
          },
        },
      ],
    });
  });

  it("builds GitHub bot actor filters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventParameterRules: {
            [PullRequestConditionId0]: {
              botActor: isRule("dependabot[bot]"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
          payloadFilter: {
            op: "in",
            path: ["sender", "login"],
            values: ["dependabot[bot]"],
          },
        },
      ],
    });
  });

  it("rejects one-of parameter groups with multiple configured options", () => {
    expect(() =>
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedConditionId0],
          eventParameterRules: {
            [PullRequestReviewRequestedConditionId0]: {
              requestedReviewer: isRule("octocat"),
              requestedTeam: isRule("platform"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toThrow(
      "Trigger event parameter group 'requestedReviewTarget' cannot serialize multiple configured options.",
    );
  });

  it("serializes one-of parameter group active options", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedConditionId0],
          eventParameterRules: {
            [PullRequestReviewRequestedConditionId0]: {
              requestedReviewer: isRule("octocat"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.review_requested",
          payloadFilter: {
            op: "in",
            path: ["requested_reviewer", "login"],
            values: ["octocat"],
          },
        },
      ],
    });
  });

  it("serializes GitHub requested bot review targets through requested reviewer login", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedConditionId0],
          eventParameterRules: {
            [PullRequestReviewRequestedConditionId0]: {
              requestedBot: isRule("mistle-agent[bot]"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.review_requested",
          payloadFilter: {
            op: "in",
            path: ["requested_reviewer", "login"],
            values: ["mistle-agent[bot]"],
          },
        },
      ],
    });
  });

  it("guards negated GitHub requested reviewer filters against team review requests", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedConditionId0],
          eventParameterRules: {
            [PullRequestReviewRequestedConditionId0]: {
              requestedReviewer: isNotRule("octocat"),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.review_requested",
          payloadFilter: {
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
      ],
    });
  });

  it("guards multi-value negated GitHub requested reviewer filters against team review requests", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventIds: [PullRequestReviewRequestedConditionId0],
          eventParameterRules: {
            [PullRequestReviewRequestedConditionId0]: {
              requestedReviewer: isNotAnyOfRule(["octocat", "hubot"]),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.review_requested",
          payloadFilter: {
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
              {
                op: "neq",
                path: ["requested_reviewer", "login"],
                value: "hubot",
              },
            ],
          },
        },
      ],
    });
  });

  it("omits trigger parameter filters with blank values from the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          eventParameterRules: {
            [PullRequestConditionId0]: {
              author: isNotRule(""),
            },
          },
        },
        GitHubEventOptions,
      ),
    ).toMatchObject({
      eventConditions: [
        {
          eventType: "github.pull_request.opened",
        },
      ],
    });
  });

  it("builds Slack app mention channel parameters into the payload filter", () => {
    expect(
      toCreateWebhookTriggerPayload(
        {
          ...BaseFormValues,
          conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
          eventIds: [SlackAppMentionConditionId0],
          eventParameterRules: {
            [SlackAppMentionConditionId0]: {
              channel: isAnyOfRule(["C12345678"]),
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
      eventConditions: [
        {
          eventType: "slack:app_mention",
          payloadFilter: {
            op: "in",
            path: ["event", "channel"],
            values: ["C12345678"],
          },
        },
      ],
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
          eventIds: [IssueCommentConditionId0],
          eventParameterRules: {
            [IssueCommentConditionId0]: {
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
      eventConditions: [
        {
          eventType: "github.issue_comment.created",
          payloadFilter: {
            op: "exists",
            path: ["issue", "pull_request"],
          },
        },
      ],
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
          eventIds: [IssueCommentConditionId0],
          eventParameterRules: {
            [IssueCommentConditionId0]: {
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
      eventConditions: [
        {
          eventType: "github.issue_comment.created",
          payloadFilter: {
            op: "contains_token",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
        },
      ],
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
