// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubGroupedConnectionLabel,
  GitHubWebhookSourceId,
} from "./webhook-automation-test-fixtures.js";
import type { WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker-state.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

const SlackConnectionId = "icn_slack";
const SlackWebhookSourceId = "iws_slack";
const SlackAppMentionTriggerId = createWebhookAutomationTriggerId({
  webhookSourceId: SlackWebhookSourceId,
  eventType: "slack:app_mention",
});

const WebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  createGithubIssueCommentCreatedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
  createGithubPullRequestOpenedEventOption({
    connectionLabel: GitHubGroupedConnectionLabel,
  }),
];

const SlackAppMentionEventOption: WebhookAutomationEventOption = {
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
  selectedTriggerIds: readonly string[];
  triggerParameterValues: Record<string, Record<string, string>>;
  disabledState?: WebhookAutomationTriggerPickerDisabledState | null;
  eventOptions?: readonly WebhookAutomationEventOption[];
  useStatefulSelection?: boolean;
}): ReturnType<typeof render> {
  TestQueryClient.setQueryData(
    ["automation-trigger-parameters", input.selectedConnectionId, "user"],
    {
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
    },
  );

  function StatefulTriggerPicker(): React.JSX.Element {
    const [selectedTriggerIds, setSelectedTriggerIds] = useState([...input.selectedTriggerIds]);

    return (
      <WebhookAutomationTriggerPicker
        error={input.error}
        eventOptions={input.eventOptions ?? WebhookEventOptions}
        hasConnectedIntegrations={input.hasConnectedIntegrations}
        {...(input.disabledState === undefined ? {} : { disabledState: input.disabledState })}
        onTriggerParameterValueChange={() => {}}
        onValueChange={setSelectedTriggerIds}
        selectedConnectionId={input.selectedConnectionId}
        selectedTriggerIds={selectedTriggerIds}
        triggerParameterValues={input.triggerParameterValues}
      />
    );
  }

  return render(
    <QueryClientProvider client={TestQueryClient}>
      {input.useStatefulSelection === true ? (
        <StatefulTriggerPicker />
      ) : (
        <WebhookAutomationTriggerPicker
          error={input.error}
          eventOptions={input.eventOptions ?? WebhookEventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          {...(input.disabledState === undefined ? {} : { disabledState: input.disabledState })}
          onTriggerParameterValueChange={() => {}}
          onValueChange={() => {}}
          selectedConnectionId={input.selectedConnectionId}
          selectedTriggerIds={input.selectedTriggerIds}
          triggerParameterValues={input.triggerParameterValues}
        />
      )}
    </QueryClientProvider>,
  );
}

describe("WebhookAutomationTriggerPicker", () => {
  it("renders selected triggers with provider logos", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {},
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.push.deleted",
        }),
      ],
      triggerParameterValues: {},
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {},
      eventOptions: [
        createGithubIssueCommentCreatedEventOption({
          availability: "wrong_profile",
          description: "Trigger is unavailable for the selected sandbox profile.",
        }),
      ],
    });

    const highlightedRows = [...container.querySelectorAll("div")].filter((element) =>
      element.className.includes("border-destructive/40"),
    );
    expect(highlightedRows.length).toBe(1);
    expect(screen.queryByText("Wrong profile")).toBeNull();
    expect(
      screen.getByText("Trigger is unavailable for the selected sandbox profile."),
    ).toBeDefined();
  });

  it("prompts the user to connect an integration when there are no connected integrations", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: false,
      selectedConnectionId: "",
      selectedTriggerIds: [],
      triggerParameterValues: {},
      eventOptions: [],
    });

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(screen.getAllByText("Connect an integration to add triggers.").length).toBeGreaterThan(
      0,
    );
  });

  it("shows a disabled no-triggers placeholder when connected integrations expose no triggers", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [],
      triggerParameterValues: {},
      eventOptions: [],
    });

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
  });

  it("shows a profile binding message when trigger selection is disabled by the selected profile", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "",
      selectedTriggerIds: [],
      triggerParameterValues: {},
      eventOptions: [],
      disabledState: {
        reason: "The selected profile has no bindings with automation triggers.",
        variant: "default",
      },
    });

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(
      screen.getAllByText("The selected profile has no bindings with automation triggers.").length,
    ).toBeGreaterThan(0);
    const helperMessage = screen.getByText(
      "The selected profile has no bindings with automation triggers.",
    );
    const helperContainer = helperMessage.closest('[data-slot="notice"]');
    if (helperContainer === null) {
      throw new Error("Expected disabled helper notice container.");
    }
    expect(helperContainer.className.includes("text-destructive")).toBe(false);
    expect(within(container).queryAllByRole("button", { name: /Remove .* trigger/ })).toHaveLength(
      0,
    );
  });

  it("shows destructive styling for disabled-state load failures", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "",
      selectedTriggerIds: [],
      triggerParameterValues: {},
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
    expect(within(container).queryAllByRole("button", { name: /Remove .* trigger/ })).toHaveLength(
      0,
    );
  });

  it("shows an empty state when no triggers are selected", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [],
      triggerParameterValues: {},
    });

    expect(screen.getAllByText("No triggers added yet.").length).toBeGreaterThan(0);
  });

  it("reuses the trigger validation copy in the empty state and highlights the container", () => {
    const { container: renderContainer } = renderTriggerPicker({
      error: "Please add a trigger",
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [],
      triggerParameterValues: {},
    });

    const errorMessage = screen.getByText("Please add a trigger");
    expect(errorMessage).toBeDefined();

    const container = errorMessage.closest('[data-slot="notice"]');
    if (container === null) {
      throw new Error("Expected trigger empty state container.");
    }

    expect(container.className.includes("text-destructive")).toBe(true);
    expect(container.className.includes("border-destructive/40")).toBe(true);
    expect(within(renderContainer).queryByRole("button", { name: /Remove .* trigger/ })).toBeNull();
  });

  it("renders selector-backed trigger parameters", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        }),
      ],
      triggerParameterValues: {
        [createWebhookAutomationTriggerId({
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
    TestQueryClient.setQueryData(["automation-trigger-parameters", SlackConnectionId, "channel"], {
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
        <WebhookAutomationTriggerPicker
          error={undefined}
          eventOptions={[SlackAppMentionEventOption]}
          hasConnectedIntegrations={true}
          onTriggerParameterValueChange={() => {}}
          onValueChange={() => {}}
          selectedConnectionId={SlackConnectionId}
          selectedTriggerIds={[SlackAppMentionTriggerId]}
          triggerParameterValues={{
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.pull_request.opened",
        }),
      ],
      triggerParameterValues: {
        [createWebhookAutomationTriggerId({
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {
        [createWebhookAutomationTriggerId({
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
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [triggerId],
      triggerParameterValues: {
        [triggerId]: {
          invocationToken: "@mistlebot",
        },
      },
    });

    expect(screen.getAllByText("includes").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("@mistlebot")).toBeDefined();
  });

  it("renders the saved explicit invocation value instead of the default", () => {
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [triggerId],
      triggerParameterValues: {
        [triggerId]: {
          invocationToken: "@review-bot",
        },
      },
    });

    expect(screen.getByDisplayValue("@review-bot")).toBeDefined();
  });

  it("renders an empty invocation token input without showing an error", () => {
    const triggerId = createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    });

    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [triggerId],
      triggerParameterValues: {
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {},
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
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {},
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
      selectedTriggerIds: [],
      triggerParameterValues: {},
      useStatefulSelection: true,
    });

    const addTriggerInput = container.querySelector('input[placeholder="Add trigger"]');
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
      within(container).getByRole("button", { name: "Remove Issue comment created trigger" }),
    ).toBeDefined();
  });

  it("adds a second trigger when one is already selected", async () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: GitHubConnectionId,
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          webhookSourceId: GitHubWebhookSourceId,
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {},
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
          name: "Remove Issue comment created trigger",
        }),
      ).toBeDefined();
      expect(
        within(container).getByRole("button", {
          hidden: true,
          name: "Remove Pull request opened trigger",
        }),
      ).toBeDefined();
    });
  });

  it("resets unsaved resource query text when the selected value changes", () => {
    TestQueryClient.setQueryData(
      ["automation-trigger-parameters", "icn_01kkk1g84mfetvga8a4b853k27", "user"],
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
      const triggerId = createWebhookAutomationTriggerId({
        webhookSourceId: GitHubWebhookSourceId,
        eventType: "github.pull_request.opened",
      });
      const [triggerParameterValues, setTriggerParameterValues] = useState<
        Record<string, Record<string, string>>
      >({
        [triggerId]: {
          author: "octocat",
        },
      });

      return (
        <>
          <button
            onClick={() => {
              setTriggerParameterValues({
                [triggerId]: {
                  author: "hubot",
                },
              });
            }}
            type="button"
          >
            Switch author
          </button>
          <WebhookAutomationTriggerPicker
            error={undefined}
            eventOptions={WebhookEventOptions}
            hasConnectedIntegrations={true}
            onTriggerParameterValueChange={({ triggerId: nextTriggerId, parameterId, value }) => {
              setTriggerParameterValues((currentValues) => ({
                ...currentValues,
                [nextTriggerId]: {
                  ...currentValues[nextTriggerId],
                  [parameterId]: value,
                },
              }));
            }}
            onValueChange={() => {}}
            selectedConnectionId="icn_01kkk1g84mfetvga8a4b853k27"
            selectedTriggerIds={[triggerId]}
            triggerParameterValues={triggerParameterValues}
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
