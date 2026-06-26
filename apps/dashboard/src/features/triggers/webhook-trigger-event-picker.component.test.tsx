// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import {
  resolveOneOfParameterGroupRulesAfterSelection,
  resolveEnumSelectParameterRule,
  WebhookTriggerEventPicker,
} from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRule,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";
import {
  createWebhookTriggerEventConditionId,
  createWebhookTriggerEventId,
} from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  createGithubPullRequestReviewRequestedEventOption,
  createGithubPullRequestReviewRequestRemovedEventOption,
  GitHubConnectionId,
  GitHubGroupedConnectionLabel,
  GitHubWebhookSourceId,
} from "./webhook-trigger-test-fixtures.js";

const SlackConnectionId = "icn_slack";
const SlackWebhookSourceId = "iws_slack";
const SlackAppMentionTriggerId = createWebhookTriggerEventId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
});
const PullRequestReviewRequestedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.review_requested",
});
const PullRequestReviewRequestRemovedTriggerId = createWebhookTriggerEventId({
  webhookSourceId: GitHubWebhookSourceId,
  eventType: "github.pull_request.review_request_removed",
});

const WebhookEventOptions: readonly WebhookTriggerEventOption[] = [
  createGithubIssueCommentCreatedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
  createGithubPullRequestOpenedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
];

function conditionId(eventOptionId: string, index = 0): string {
  return createWebhookTriggerEventConditionId({ eventOptionId, index });
}

const SlackAppMentionConditionId = conditionId(SlackAppMentionTriggerId);
const PullRequestReviewRequestedConditionId = conditionId(PullRequestReviewRequestedTriggerId);
const PullRequestReviewRequestRemovedConditionId = conditionId(
  PullRequestReviewRequestRemovedTriggerId,
);

const PullRequestReviewRequestedEventOption = createGithubPullRequestReviewRequestedEventOption({
  id: PullRequestReviewRequestedTriggerId,
  connectionLabel: GitHubGroupedConnectionLabel,
});
const PullRequestReviewRequestRemovedEventOption =
  createGithubPullRequestReviewRequestRemovedEventOption({
    id: PullRequestReviewRequestRemovedTriggerId,
    connectionLabel: GitHubGroupedConnectionLabel,
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

function existsRule() {
  return {
    operator: WebhookTriggerEventParameterRuleOperators.EXISTS,
    value: "exists",
  };
}

const SlackAppMentionEventOption: WebhookTriggerEventOption = {
  id: SlackAppMentionTriggerId,
  eventType: "slack:app_mention",
  integrationWebhookSourceId: SlackWebhookSourceId,
  connectionId: SlackConnectionId,
  connectionLabel: "Slack - Slack Engineering",
  label: "App mention",
  logoKey: "slack",
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

const TestQueryClient = createTestQueryClient();

afterEach(() => {
  TestQueryClient.clear();
});

function renderTriggerPicker(input: {
  error?: string;
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedEventIds: readonly string[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  eventOptions?: readonly WebhookTriggerEventOption[];
  teamResources?: IntegrationConnectionResources;
  useStatefulSelection?: boolean;
}): ReturnType<typeof render> {
  TestQueryClient.setQueryData(["trigger-trigger-parameters", input.selectedConnectionId, "user"], {
    connectionId: input.selectedConnectionId,
    familyId: "github",
    kind: "user",
    syncState: "ready",
    items: [
      {
        id: "icr_github_user_1",
        familyId: "github",
        kind: "user",
        externalId: "1001",
        handle: "octocat",
        displayName: "octocat",
        status: "accessible",
        metadata: {},
      },
    ],
    page: {
      totalResults: 1,
      nextCursor: null,
      previousCursor: null,
    },
  });
  TestQueryClient.setQueryData(["trigger-trigger-parameters", input.selectedConnectionId, "team"], {
    connectionId: input.selectedConnectionId,
    familyId: "github",
    kind: "team",
    syncState: "ready",
    items: [
      {
        id: "icr_github_team_1",
        familyId: "github",
        kind: "team",
        externalId: "2001",
        handle: "platform",
        displayName: "Platform (mistle)",
        status: "accessible",
        metadata: {
          organizationLogins: ["mistle"],
        },
      },
    ],
    page: {
      totalResults: 1,
      nextCursor: null,
      previousCursor: null,
    },
    ...(input.teamResources ?? {}),
  });
  TestQueryClient.setQueryData(["trigger-trigger-parameters", input.selectedConnectionId, "bot"], {
    connectionId: input.selectedConnectionId,
    familyId: "github",
    kind: "bot",
    syncState: "ready",
    items: [
      {
        id: "icr_github_bot_1",
        familyId: "github",
        kind: "bot",
        externalId: "3001",
        handle: "dependabot[bot]",
        displayName: "dependabot[bot]",
        status: "accessible",
        metadata: {},
      },
      {
        id: "icr_github_bot_2",
        familyId: "github",
        kind: "bot",
        externalId: "3002",
        handle: "mistle-agent[bot]",
        displayName: "mistle-agent[bot]",
        status: "accessible",
        metadata: {},
      },
    ],
    page: {
      totalResults: 2,
      nextCursor: null,
      previousCursor: null,
    },
  });
  TestQueryClient.setQueryData(
    ["trigger-trigger-parameters", input.selectedConnectionId, "branch"],
    {
      connectionId: input.selectedConnectionId,
      familyId: "github",
      kind: "branch",
      syncState: "ready",
      items: [
        {
          id: "icr_github_branch_1",
          familyId: "github",
          kind: "branch",
          externalId: "repo_1:main",
          handle: "main",
          displayName: "main",
          status: "accessible",
          metadata: {},
        },
      ],
      page: {
        totalResults: 1,
        nextCursor: null,
        previousCursor: null,
      },
    },
  );

  function StatefulTriggerPicker(): React.JSX.Element {
    const [selectedEventIds, setSelectedEventIds] = useState([...input.selectedEventIds]);

    return (
      <WebhookTriggerEventPicker
        error={input.error}
        eventOptions={input.eventOptions ?? WebhookEventOptions}
        hasConnectedIntegrations={input.hasConnectedIntegrations}
        {...(input.disabledState === undefined ? {} : { disabledState: input.disabledState })}
        onEventParameterRuleChange={() => {}}
        onEventParameterRulesChange={() => {}}
        onValueChange={setSelectedEventIds}
        selectedConnectionId={input.selectedConnectionId}
        selectedEventIds={selectedEventIds}
        eventParameterRules={input.eventParameterRules}
      />
    );
  }

  return render(
    <QueryClientProvider client={TestQueryClient}>
      {input.useStatefulSelection === true ? (
        <StatefulTriggerPicker />
      ) : (
        <WebhookTriggerEventPicker
          error={input.error}
          eventOptions={input.eventOptions ?? WebhookEventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          {...(input.disabledState === undefined ? {} : { disabledState: input.disabledState })}
          onEventParameterRuleChange={() => {}}
          onEventParameterRulesChange={() => {}}
          onValueChange={() => {}}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventIds={input.selectedEventIds}
          eventParameterRules={input.eventParameterRules}
        />
      )}
    </QueryClientProvider>,
  );
}

function createSlackChannelResources(): IntegrationConnectionResources {
  return {
    connectionId: SlackConnectionId,
    familyId: "slack",
    kind: "channel",
    syncState: "ready",
    items: [
      {
        id: "icr_slack_channel_1",
        familyId: "slack",
        kind: "channel",
        externalId: "C12345678",
        handle: "C12345678",
        displayName: "#alerts",
        status: "accessible",
        metadata: {},
      },
    ],
  };
}

function renderSlackChannelTriggerPicker(): ReturnType<typeof render> {
  TestQueryClient.setQueryData(
    ["trigger-trigger-parameters", SlackConnectionId, "channel"],
    createSlackChannelResources(),
  );

  return render(
    <QueryClientProvider client={TestQueryClient}>
      <WebhookTriggerEventPicker
        error={undefined}
        eventOptions={[SlackAppMentionEventOption]}
        hasConnectedIntegrations={true}
        onEventParameterRuleChange={() => {}}
        onEventParameterRulesChange={() => {}}
        onValueChange={() => {}}
        selectedConnectionId={SlackConnectionId}
        selectedEventIds={[SlackAppMentionConditionId]}
        eventParameterRules={{
          [SlackAppMentionConditionId]: {
            channel: isAnyOfRule(["C12345678"]),
          },
        }}
      />
    </QueryClientProvider>,
  );
}

function openMultiResourcePickerByLabel(label: string): HTMLElement {
  const combobox = screen.getAllByRole("combobox", { name: label }).find((element) => {
    return element.getAttribute("data-slot") === "combobox-chip-input";
  });
  if (combobox === undefined) {
    throw new Error(`Expected multi resource picker '${label}'.`);
  }

  const chipToolbar = combobox.closest('[data-slot="combobox-chips"]');
  if (chipToolbar === null) {
    throw new Error(`Expected chip toolbar for multi resource picker '${label}'.`);
  }

  fireEvent.click(chipToolbar);
  return combobox;
}

function expectSelectedResourceLabel(label: string): void {
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
}

describe("WebhookTriggerEventPicker", () => {
  it("renders selected triggers with provider logos", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterRules: {},
    });

    const logo = container.querySelector("img");
    if (logo === null) {
      throw new Error("Expected the selected trigger to render an integration logo.");
    }
    expect(logo.getAttribute("src")).toBe(resolveIntegrationLogoPath({ logoKey: "github" }));
    expect(screen.getByText("Issue comment created")).toBeDefined();
    expect(screen.queryByText("github.issue_comment.created")).toBeNull();
  });

  it("shows unavailable saved triggers when they are no longer present in current options", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.push.deleted",
        }),
      ],
      eventParameterRules: {},
    });

    expect(screen.getByText("github.push.deleted")).toBeDefined();
    const highlightedRows = [...container.querySelectorAll("div")].filter((element) =>
      element.className.includes("border-destructive/40"),
    );
    expect(highlightedRows.length).toBe(1);
  });

  it("shows selected triggers that are incompatible with the selected profile", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterRules: {},
      eventOptions: [
        createGithubIssueCommentCreatedEventOption({
          availability: "wrong_profile",
          description: "Event is unavailable for the selected sandbox profile.",
        }),
      ],
    });

    const highlightedRows = [...container.querySelectorAll("div")].filter((element) =>
      element.className.includes("border-destructive/40"),
    );
    expect(highlightedRows.length).toBe(1);
    expect(screen.queryByText("Wrong profile")).toBeNull();
    expect(
      screen.getByText("Event is unavailable for the selected sandbox profile."),
    ).toBeDefined();
  });

  it("prompts the user to connect an integration when there are no connected integrations", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: false,
      selectedConnectionId: "",
      selectedEventIds: [],
      eventParameterRules: {},
      eventOptions: [],
    });

    const input = container.querySelector('input[placeholder="No events available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(screen.getAllByText("Connect an integration to add events.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No trigger events are available yet/)).toBeNull();
  });

  it("shows a disabled no-triggers placeholder when connected integrations expose no triggers", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [],
      eventParameterRules: {},
      eventOptions: [],
    });

    const input = container.querySelector('input[placeholder="No events available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    const noticeMessage = screen.getByText(/No trigger events are available yet/);
    expect(noticeMessage).toBeTruthy();
    const noticeContainer = noticeMessage.closest('[data-slot="notice"]');
    if (noticeContainer === null) {
      throw new Error("Expected no-trigger-events notice container.");
    }
    expect(noticeContainer.className.includes("text-destructive")).toBe(false);
    const integrationsLink = screen.getByRole("link", { name: "Integrations" });
    expect(integrationsLink.getAttribute("href")).toBe("/integrations");
  });

  it("keeps the add-condition input available after all event types have selected conditions", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: WebhookEventOptions.map((option, index) => conditionId(option.id, index)),
      eventParameterRules: {},
    });

    const input = container.querySelector('input[placeholder="Add condition"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBeNull();
    expect(screen.queryByText(/No trigger events are available yet/)).toBeNull();
  });

  it("shows a profile binding message when trigger selection is disabled by the selected profile", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "",
      selectedEventIds: [],
      eventParameterRules: {},
      eventOptions: [],
      disabledState: {
        reason:
          "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
        variant: "default",
      },
    });

    const input = container.querySelector('input[placeholder="No events available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(
      screen.getAllByText(
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/No trigger events are available yet/)).toBeNull();
    const helperMessage = screen.getByText(
      "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
    );
    const helperContainer = helperMessage.closest('[data-slot="notice"]');
    if (helperContainer === null) {
      throw new Error("Expected disabled helper notice container.");
    }
    expect(helperContainer.className.includes("text-destructive")).toBe(false);
    expect(within(container).queryAllByRole("button", { name: /Remove .* event/ })).toHaveLength(0);
  });

  it("shows destructive styling for disabled-state load failures", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "",
      selectedEventIds: [],
      eventParameterRules: {},
      eventOptions: [],
      disabledState: {
        reason: "Could not load profile bindings.",
        variant: "alert",
      },
    });

    const helperMessage = screen.getByText("Could not load profile bindings.");
    const helperContainer = helperMessage.closest('[data-slot="notice"]');
    if (helperContainer === null) {
      throw new Error("Expected disabled helper notice container.");
    }

    expect(helperContainer.className.includes("text-destructive")).toBe(true);
    expect(within(container).queryAllByRole("button", { name: /Remove .* event/ })).toHaveLength(0);
  });

  it("shows an empty state when no triggers are selected", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [],
      eventParameterRules: {},
    });

    expect(screen.getAllByText("No events added yet.").length).toBeGreaterThan(0);
  });

  it("reuses the trigger validation copy in the empty state and highlights the container", () => {
    const { container: renderContainer } = renderTriggerPicker({
      error: "Please add an event",
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [],
      eventParameterRules: {},
    });

    const errorMessage = screen.getByText("Please add an event");
    expect(errorMessage).toBeDefined();

    const container = errorMessage.closest('[data-slot="notice"]');
    if (container === null) {
      throw new Error("Expected trigger empty state container.");
    }

    expect(container.className.includes("text-destructive")).toBe(true);
    expect(container.className.includes("border-destructive/40")).toBe(true);
    expect(within(renderContainer).queryByRole("button", { name: /Remove .* event/ })).toBeNull();
  });

  it("renders selector-backed trigger parameters", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request.opened",
    });
    const selectedConditionId = conditionId(triggerId);

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          author: isRule("octocat"),
        },
      },
    });

    expectSelectedResourceLabel("octocat");
    expect(screen.queryByPlaceholderText("Any author")).toBeNull();
  });

  it("renders Slack channel selector-backed trigger parameters", async () => {
    renderSlackChannelTriggerPicker();

    await waitFor(() => {
      expect(screen.getByText("#alerts")).toBeDefined();
    });
  });

  it("renders a resource refresh control for Slack channel trigger parameters", async () => {
    renderSlackChannelTriggerPicker();

    await waitFor(() => {
      expect(screen.getByText("#alerts")).toBeDefined();
    });
    openMultiResourcePickerByLabel("channel");

    const refreshButton = await screen.findByRole("button", { name: "Refresh channels" });
    refreshButton.focus();

    expect(screen.getByRole("button", { name: "Refresh channels" })).toBeDefined();
    expect(document.activeElement).toBe(refreshButton);
  });

  it("preserves missing selected resource values as unavailable historical selections", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request.opened",
    });
    const selectedConditionId = conditionId(triggerId);

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          author: isRule("retired-user"),
        },
      },
    });

    expect(screen.getAllByText("retired-user").length).toBeGreaterThan(0);
    expect(
      screen.getByText("The highlighted resources are no longer available. Please remove them."),
    ).toBeDefined();
  });

  it("renders GitHub actor bot parameters from synced bot resources", async () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request.opened",
    });
    const selectedConditionId = conditionId(triggerId);

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          botActor: isRule("dependabot[bot]"),
        },
      },
    });

    expect(screen.getByText("Pull request opened")).toBeDefined();
    expect(screen.getAllByText("by bot").length).toBeGreaterThan(0);
    await waitFor(() => {
      expectSelectedResourceLabel("dependabot[bot]");
    });
  });

  it("renders enum-backed trigger parameters", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    const selectedConditionId = conditionId(triggerId);

    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          target: existsRule(),
        },
      },
    });

    const parameterSelect = container.querySelector('[data-slot="select-trigger"]');
    if (parameterSelect === null) {
      throw new Error("Expected enum-backed trigger parameter select.");
    }

    expect(parameterSelect.textContent).toContain("pull request");
  });

  it("renders GitHub review request target parameters as one mutually exclusive control", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedReviewer: isRule("octocat"),
        },
      },
    });

    expect(screen.getByText("Pull request review requested")).toBeDefined();
    expect(screen.getByText("for reviewer")).toBeDefined();
    expect(screen.getAllByText("is").length).toBeGreaterThan(0);
    expect(screen.queryByText("for team")).toBeNull();
    expect(container.textContent).not.toContain("Any GitHub team");
  });

  it("renders GitHub review request team targets from synced team resources", async () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedTeam: isRule("platform"),
        },
      },
    });

    expect(screen.getByText("Pull request review requested")).toBeDefined();
    expect(screen.getAllByText("for team").length).toBeGreaterThan(0);
    await waitFor(() => {
      expectSelectedResourceLabel("Platform (mistle)");
    });
    expect(container.textContent).not.toContain("Any requested reviewer");
  });

  it("selects GitHub review request one-of groups from multi-value rules", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedTeam: isAnyOfRule(["platform"]),
        },
      },
    });

    expect(screen.getAllByText("for team").length).toBeGreaterThan(0);
    expect(screen.queryByText("for reviewer")).toBeNull();
    await waitFor(() => {
      expectSelectedResourceLabel("Platform (mistle)");
    });
  });

  it("renders a resource refresh control for one-of resource trigger parameters", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedTeam: isRule("platform"),
        },
      },
    });

    await waitFor(() => {
      expectSelectedResourceLabel("Platform (mistle)");
    });
    openMultiResourcePickerByLabel("requested GitHub team");

    expect(
      await screen.findByRole("button", { name: "Refresh requested GitHub teams" }),
    ).toBeDefined();
  });

  it("pluralizes resource refresh labels for branch trigger parameters", async () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.pull_request.opened",
    });
    const selectedConditionId = conditionId(triggerId);

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          baseBranch: isRule("main"),
        },
      },
    });

    await waitFor(() => {
      expectSelectedResourceLabel("main");
    });
    openMultiResourcePickerByLabel("base branch");

    const malformedBranchPlural = "Refresh base " + "branch" + "s";

    expect(await screen.findByRole("button", { name: "Refresh base branches" })).toBeDefined();
    expect(screen.queryByRole("button", { name: malformedBranchPlural })).toBeNull();
  });

  it("renders GitHub review request bot targets from synced bot resources", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedBot: isRule("mistle-agent[bot]"),
        },
      },
    });

    expect(screen.getByText("Pull request review requested")).toBeDefined();
    expect(screen.getAllByText("for bot").length).toBeGreaterThan(0);
    await waitFor(() => {
      expectSelectedResourceLabel("mistle-agent[bot]");
    });
  });

  it("renders unavailable GitHub review request team target values", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedTeam: isRule("legacy-team"),
        },
      },
    });

    await waitFor(() => {
      expect(screen.getAllByText("legacy-team").length).toBeGreaterThan(0);
    });
  });

  it("shows GitHub team sync errors separately from an empty team list", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedTeam: isRule("platform"),
        },
      },
      teamResources: {
        connectionId: GitHubConnectionId,
        familyId: "github",
        kind: "team",
        syncState: "error",
        lastErrorMessage:
          "GitHub returned 403 while listing teams. Reapprove Members read permission.",
        items: [],
      },
    });

    expect(screen.getAllByText("for team").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getAllByText("platform").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(
        "GitHub returned 403 while listing teams. Reapprove Members read permission.",
      ),
    ).toBeDefined();
    expect(screen.queryByPlaceholderText("No teams available")).toBeNull();
  });

  it("renders GitHub review request removed team targets from synced team resources", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestRemovedConditionId],
      eventOptions: [PullRequestReviewRequestRemovedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestRemovedConditionId]: {
          requestedTeam: isRule("platform"),
        },
      },
    });

    expect(screen.getByText("Pull request review request removed")).toBeDefined();
    expect(screen.getAllByText("for team").length).toBeGreaterThan(0);
    await waitFor(() => {
      expectSelectedResourceLabel("Platform (mistle)");
    });
  });

  it("renders GitHub review request removed bot targets from synced bot resources", async () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestRemovedConditionId],
      eventOptions: [PullRequestReviewRequestRemovedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestRemovedConditionId]: {
          requestedBot: isRule("mistle-agent[bot]"),
        },
      },
    });

    expect(screen.getByText("Pull request review request removed")).toBeDefined();
    expect(screen.getAllByText("for bot").length).toBeGreaterThan(0);
    await waitFor(() => {
      expectSelectedResourceLabel("mistle-agent[bot]");
    });
  });

  it("builds one replacement rules object when clearing inactive one-of group options", () => {
    const group = PullRequestReviewRequestedEventOption.parameterGroups?.find(
      (group) => group.id === "requestedReviewTarget",
    );
    if (group === undefined) {
      throw new Error("Expected test event option to define a requested review target group.");
    }

    expect(
      resolveOneOfParameterGroupRulesAfterSelection({
        group,
        rules: {
          requestedReviewer: isRule("octocat"),
          requestedBot: isRule("mistle-agent[bot]"),
        },
        selectedParameterId: "requestedTeam",
      }),
    ).toEqual({
      requestedReviewer: {
        operator: WebhookTriggerEventParameterRuleOperators.IS,
        value: "",
      },
      requestedBot: {
        operator: WebhookTriggerEventParameterRuleOperators.IS,
        value: "",
      },
    });
  });

  it("preserves exclusion rules for GitHub review request target parameters", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [PullRequestReviewRequestedConditionId],
      eventOptions: [PullRequestReviewRequestedEventOption],
      eventParameterRules: {
        [PullRequestReviewRequestedConditionId]: {
          requestedReviewer: {
            operator: WebhookTriggerEventParameterRuleOperators.IS_NOT,
            value: "octocat",
          },
        },
      },
    });

    expect(screen.getByText("for reviewer")).toBeDefined();
    expect(screen.getByText("is not")).toBeDefined();
  });

  it("preserves exclusion operators when editing multi-value resources", async () => {
    TestQueryClient.setQueryData(["trigger-trigger-parameters", GitHubConnectionId, "user"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "user",
      syncState: "ready",
      items: [
        {
          id: "icr_github_user_1",
          familyId: "github",
          kind: "user",
          externalId: "1001",
          handle: "octocat",
          displayName: "octocat",
          status: "accessible",
          metadata: {},
        },
        {
          id: "icr_github_user_2",
          familyId: "github",
          kind: "user",
          externalId: "1002",
          handle: "hubot",
          displayName: "hubot",
          status: "accessible",
          metadata: {},
        },
      ],
      page: {
        totalResults: 2,
        nextCursor: null,
        previousCursor: null,
      },
    });

    function StatefulMultiValueResourceSelection(): React.JSX.Element {
      const eventOptionId = createWebhookTriggerEventId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.pull_request.opened",
      });
      const triggerId = conditionId(eventOptionId);
      const [eventParameterRules, setEventParameterRules] =
        useState<WebhookTriggerEventParameterRuleMap>({
          [triggerId]: {
            author: isNotAnyOfRule(["octocat"]),
          },
        });

      return (
        <>
          <output aria-label="event parameter rules">
            {JSON.stringify(eventParameterRules[triggerId]?.author)}
          </output>
          <WebhookTriggerEventPicker
            error={undefined}
            eventOptions={WebhookEventOptions}
            hasConnectedIntegrations={true}
            onEventParameterRuleChange={({ triggerId: nextTriggerId, parameterId, rule }) => {
              setEventParameterRules((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: {
                  ...currentValues[nextTriggerId],
                  [parameterId]: rule,
                },
              }));
            }}
            onEventParameterRulesChange={({ triggerId: nextTriggerId, rules }) => {
              setEventParameterRules((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: rules,
              }));
            }}
            onValueChange={() => {}}
            selectedConnectionId={GitHubConnectionId}
            selectedEventIds={[triggerId]}
            eventParameterRules={eventParameterRules}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={TestQueryClient}>
        <StatefulMultiValueResourceSelection />
      </QueryClientProvider>,
    );

    openMultiResourcePickerByLabel("actor");
    fireEvent.click(screen.getByRole("option", { name: "hubot" }));

    await waitFor(() => {
      expect(screen.getByLabelText("event parameter rules").textContent).toBe(
        JSON.stringify(isNotAnyOfRule(["octocat", "hubot"])),
      );
    });
  });

  it("resolves enum equality parameter selections as equality rules", () => {
    const parameter: WebhookTriggerEventParameterRule = resolveEnumSelectParameterRule({
      parameter: {
        id: "action",
        label: "action",
        kind: "enum-select",
        matchMode: "eq",
        payloadPath: ["action"],
        placeholder: "Any action",
        options: [
          {
            value: "opened",
            label: "opened",
          },
        ],
      },
      value: "opened",
    });

    expect(parameter).toEqual(isRule("opened"));
  });

  it("renders invocation token parameters as an optional input", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    const selectedConditionId = conditionId(triggerId);
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          invocationToken: containsTokenRule("@mistlebot"),
        },
      },
    });

    expect(screen.getAllByText("includes").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("@mistlebot")).toBeDefined();
  });

  it("renders the saved explicit invocation value instead of the default", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    const selectedConditionId = conditionId(triggerId);
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          invocationToken: containsTokenRule("@review-bot"),
        },
      },
    });

    expect(screen.getByDisplayValue("@review-bot")).toBeDefined();
  });

  it("renders an empty invocation token input without showing an error", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    const selectedConditionId = conditionId(triggerId);

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [selectedConditionId],
      eventParameterRules: {
        [selectedConditionId]: {
          invocationToken: containsTokenRule(""),
        },
      },
    });

    expect(screen.queryByText("Enter an invocation token.")).toBeNull();
    const emptyInvocationInput = screen
      .getAllByRole("textbox")
      .find((element) => element.getAttribute("value") === "");
    if (emptyInvocationInput === undefined) {
      throw new Error("Expected an empty invocation token input.");
    }
  });

  it("renders unset enum-backed trigger parameters as placeholders", () => {
    const issueCommentOptionId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [conditionId(issueCommentOptionId)],
      eventParameterRules: {},
    });

    const selectValue = container.querySelector('[data-slot="select-value"]');
    if (selectValue === null) {
      throw new Error("Expected enum select value.");
    }

    expect(selectValue.textContent).toBe("Any comment target");
  });

  it("keeps already selected event types available for additional conditions", () => {
    const issueCommentOptionId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [conditionId(issueCommentOptionId)],
      eventParameterRules: {},
    });

    const addTriggerButton = container.querySelector('button[data-slot="input-group-button"]');
    if (addTriggerButton === null) {
      throw new Error("Expected add trigger button.");
    }

    fireEvent.click(addTriggerButton);

    expect(screen.getByRole("option", { name: "Issue comment created" })).toBeDefined();
    expect(screen.getByRole("option", { name: "Pull request opened" })).toBeDefined();
  });

  it("closes the add-trigger list after selecting a trigger", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [],
      eventParameterRules: {},
      useStatefulSelection: true,
    });

    const addTriggerInput = container.querySelector('input[placeholder="Add condition"]');
    if (addTriggerInput === null) {
      throw new Error("Expected add trigger input.");
    }

    const addTriggerButton = container.querySelector('button[data-slot="input-group-button"]');
    if (addTriggerButton === null) {
      throw new Error("Expected add trigger button.");
    }

    fireEvent.click(addTriggerButton);
    expect(addTriggerInput.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: "Issue comment created" })).toBeDefined();
    expect(screen.getByRole("option", { name: "Pull request opened" })).toBeDefined();

    fireEvent.click(screen.getByRole("option", { name: "Issue comment created" }));

    expect(addTriggerInput.getAttribute("aria-expanded")).toBe("false");
    expect(
      within(container).getByRole("button", { name: "Remove Issue comment created event" }),
    ).toBeDefined();
  });

  it("adds a second trigger when one is already selected", async () => {
    const issueCommentOptionId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [conditionId(issueCommentOptionId)],
      eventParameterRules: {},
      useStatefulSelection: true,
    });

    const addTriggerButton = container.querySelector('button[data-slot="input-group-button"]');
    if (addTriggerButton === null) {
      throw new Error("Expected add trigger button.");
    }

    fireEvent.click(addTriggerButton);
    fireEvent.click(screen.getByRole("option", { name: "Pull request opened" }));

    await waitFor(() => {
      expect(
        within(container).getByRole("button", {
          hidden: true,
          name: "Remove Issue comment created event",
        }),
      ).toBeDefined();
      expect(
        within(container).getByRole("button", {
          hidden: true,
          name: "Remove Pull request opened event",
        }),
      ).toBeDefined();
    });
  });

  it("resets unsaved resource query text when the selected value changes", () => {
    TestQueryClient.setQueryData(
      ["trigger-trigger-parameters", "icn_01kkk1g84mfetvga8a4b853k27", "user"],
      {
        connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
        familyId: "github",
        kind: "user",
        syncState: "ready",
        items: [
          {
            id: "icr_github_user_1",
            familyId: "github",
            kind: "user",
            externalId: "1001",
            handle: "octocat",
            displayName: "octocat",
            status: "accessible",
            metadata: {},
          },
          {
            id: "icr_github_user_2",
            familyId: "github",
            kind: "user",
            externalId: "1002",
            handle: "hubot",
            displayName: "hubot",
            status: "accessible",
            metadata: {},
          },
        ],
        page: {
          totalResults: 2,
          nextCursor: null,
          previousCursor: null,
        },
      },
    );

    function StatefulResourceSelection(): React.JSX.Element {
      const eventOptionId = createWebhookTriggerEventId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.pull_request.opened",
      });
      const triggerId = conditionId(eventOptionId);
      const [eventParameterRules, setEventParameterRules] =
        useState<WebhookTriggerEventParameterRuleMap>({
          [triggerId]: {
            author: isRule("octocat"),
          },
        });

      return (
        <>
          <button
            onClick={() => {
              setEventParameterRules({
                [triggerId]: {
                  author: isRule("hubot"),
                },
              });
            }}
            type="button"
          >
            Switch author
          </button>
          <WebhookTriggerEventPicker
            error={undefined}
            eventOptions={WebhookEventOptions}
            hasConnectedIntegrations={true}
            onEventParameterRuleChange={({ triggerId: nextTriggerId, parameterId, rule }) => {
              setEventParameterRules((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: {
                  ...currentValues[nextTriggerId],
                  [parameterId]: rule,
                },
              }));
            }}
            onEventParameterRulesChange={({ triggerId: nextTriggerId, rules }) => {
              setEventParameterRules((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: rules,
              }));
            }}
            onValueChange={() => {}}
            selectedConnectionId="icn_01kkk1g84mfetvga8a4b853k27"
            selectedEventIds={[triggerId]}
            eventParameterRules={eventParameterRules}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={TestQueryClient}>
        <StatefulResourceSelection />
      </QueryClientProvider>,
    );

    expectSelectedResourceLabel("octocat");
    const resourceCombobox = openMultiResourcePickerByLabel("actor");
    fireEvent.change(resourceCombobox, {
      target: { value: "unsaved query" },
    });
    fireEvent.keyDown(resourceCombobox, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Switch author" }));

    expectSelectedResourceLabel("hubot");
    expect(screen.queryByDisplayValue("unsaved query")).toBeNull();
  });
});
