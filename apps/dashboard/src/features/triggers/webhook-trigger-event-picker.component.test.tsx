// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import { WebhookTriggerEventPicker } from "./webhook-trigger-event-picker.js";
import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
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

const WebhookEventOptions: readonly WebhookTriggerEventOption[] = [
  createGithubIssueCommentCreatedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
  createGithubPullRequestOpenedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
];

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
  eventParameterValues: WebhookTriggerEventParameterValueMap;
  disabledState?: WebhookTriggerEventPickerDisabledState | null;
  eventOptions?: readonly WebhookTriggerEventOption[];
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

  function StatefulTriggerPicker(): React.JSX.Element {
    const [selectedEventIds, setSelectedEventIds] = useState([...input.selectedEventIds]);

    return (
      <WebhookTriggerEventPicker
        error={input.error}
        eventOptions={input.eventOptions ?? WebhookEventOptions}
        hasConnectedIntegrations={input.hasConnectedIntegrations}
        {...(input.disabledState === undefined ? {} : { disabledState: input.disabledState })}
        onEventParameterValueChange={() => {}}
        onValueChange={setSelectedEventIds}
        selectedConnectionId={input.selectedConnectionId}
        selectedEventIds={selectedEventIds}
        eventParameterValues={input.eventParameterValues}
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
          onEventParameterValueChange={() => {}}
          onValueChange={() => {}}
          selectedConnectionId={input.selectedConnectionId}
          selectedEventIds={input.selectedEventIds}
          eventParameterValues={input.eventParameterValues}
        />
      )}
    </QueryClientProvider>,
  );
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
      eventParameterValues: {},
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
      eventParameterValues: {},
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
      eventParameterValues: {},
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
      eventParameterValues: {},
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
      eventParameterValues: {},
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

  it("does not show setup guidance after all available triggers are selected", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: WebhookEventOptions.map((option) => option.id),
      eventParameterValues: {},
    });

    const input = container.querySelector('input[placeholder="No events available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(screen.queryByText(/No trigger events are available yet/)).toBeNull();
  });

  it("shows a profile binding message when trigger selection is disabled by the selected profile", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "",
      selectedEventIds: [],
      eventParameterValues: {},
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
      eventParameterValues: {},
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
      eventParameterValues: {},
    });

    expect(screen.getAllByText("No events added yet.").length).toBeGreaterThan(0);
  });

  it("reuses the trigger validation copy in the empty state and highlights the container", () => {
    const { container: renderContainer } = renderTriggerPicker({
      error: "Please add an event",
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [],
      eventParameterValues: {},
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
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        }),
      ],
      eventParameterValues: {
        [createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        })]: {
          author: "octocat",
        },
      },
    });

    expect(screen.getAllByDisplayValue("octocat").length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Any author")).toBeNull();
  });

  it("renders Slack channel selector-backed trigger parameters", async () => {
    TestQueryClient.setQueryData(["trigger-trigger-parameters", SlackConnectionId, "channel"], {
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
      page: {
        totalResults: 1,
        nextCursor: null,
        previousCursor: null,
      },
    });
    render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerEventPicker
          error={undefined}
          eventOptions={[SlackAppMentionEventOption]}
          hasConnectedIntegrations={true}
          onEventParameterValueChange={() => {}}
          onValueChange={() => {}}
          selectedConnectionId={SlackConnectionId}
          selectedEventIds={[SlackAppMentionTriggerId]}
          eventParameterValues={{
            [SlackAppMentionTriggerId]: {
              channel: "C12345678",
            },
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByDisplayValue("#alerts").length).toBeGreaterThan(0);
    });
  });

  it("preserves missing selected resource values as unavailable historical selections", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        }),
      ],
      eventParameterValues: {
        [createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        })]: {
          author: "retired-user",
        },
      },
    });

    expect(screen.getAllByDisplayValue("retired-user (Unavailable)").length).toBeGreaterThan(0);
  });

  it("renders enum-backed trigger parameters", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterValues: {
        [createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        })]: {
          target: "exists",
        },
      },
    });

    const parameterSelect = container.querySelector('[data-slot="select-trigger"]');
    if (parameterSelect === null) {
      throw new Error("Expected enum-backed trigger parameter select.");
    }

    expect(parameterSelect.textContent).toContain("pull request");
  });

  it("renders invocation token parameters as an optional input", () => {
    const triggerId = createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [triggerId],
      eventParameterValues: {
        [triggerId]: {
          invocationToken: "@mistlebot",
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
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [triggerId],
      eventParameterValues: {
        [triggerId]: {
          invocationToken: "@review-bot",
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

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [triggerId],
      eventParameterValues: {
        [triggerId]: {
          invocationToken: "",
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
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterValues: {},
    });

    const selectValue = container.querySelector('[data-slot="select-value"]');
    if (selectValue === null) {
      throw new Error("Expected enum select value.");
    }

    expect(selectValue.textContent).toBe("Any comment target");
  });

  it("hides already selected triggers from the add-trigger list", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterValues: {},
    });

    const addTriggerButton = container.querySelector('button[data-slot="input-group-button"]');
    if (addTriggerButton === null) {
      throw new Error("Expected add trigger button.");
    }

    fireEvent.click(addTriggerButton);

    expect(screen.queryByRole("option", { name: "Issue comment created" })).toBeNull();
    expect(screen.getByRole("option", { name: "Pull request opened" })).toBeDefined();
  });

  it("closes the add-trigger list after selecting a trigger", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedEventIds: [],
      eventParameterValues: {},
      useStatefulSelection: true,
    });

    const addTriggerInput = container.querySelector('input[placeholder="Add event"]');
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
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedEventIds: [
        createWebhookTriggerEventId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      eventParameterValues: {},
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
      const triggerId = createWebhookTriggerEventId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.pull_request.opened",
      });
      const [eventParameterValues, setEventParameterValues] =
        useState<WebhookTriggerEventParameterValueMap>({
          [triggerId]: {
            author: "octocat",
          },
        });

      return (
        <>
          <button
            onClick={() => {
              setEventParameterValues({
                [triggerId]: {
                  author: "hubot",
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
            onEventParameterValueChange={({ triggerId: nextTriggerId, parameterId, value }) => {
              setEventParameterValues((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: {
                  ...currentValues[nextTriggerId],
                  [parameterId]: value,
                },
              }));
            }}
            onValueChange={() => {}}
            selectedConnectionId="icn_01kkk1g84mfetvga8a4b853k27"
            selectedEventIds={[triggerId]}
            eventParameterValues={eventParameterValues}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={TestQueryClient}>
        <StatefulResourceSelection />
      </QueryClientProvider>,
    );

    const resourceComboboxes = screen
      .getAllByRole("combobox")
      .filter((element) => element.getAttribute("placeholder") === "Select author");
    const resourceCombobox = resourceComboboxes[0];
    if (resourceCombobox === undefined) {
      throw new Error("Expected resource combobox.");
    }
    fireEvent.change(resourceCombobox, {
      target: { value: "unsaved query" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch author" }));

    const updatedResourceComboboxes = screen
      .getAllByRole("combobox")
      .filter((element) => element.getAttribute("placeholder") === "Select author");
    expect(updatedResourceComboboxes[0]?.getAttribute("value")).toBe("hubot");
    expect(screen.queryByDisplayValue("unsaved query")).toBeNull();
  });
});
