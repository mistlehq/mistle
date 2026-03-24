// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-list-helpers.js";
import {
  groupWebhookAutomationEventOptions,
  WebhookAutomationTriggerPicker,
} from "./webhook-automation-trigger-picker.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

const WebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: createWebhookAutomationTriggerId({
      connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      eventType: "github.issue_comment.created",
    }),
    eventType: "github.issue_comment.created",
    connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
    connectionLabel: "GitHub - GitHub Engineering",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
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
    id: createWebhookAutomationTriggerId({
      connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      eventType: "github.pull_request.opened",
    }),
    eventType: "github.pull_request.opened",
    connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
    connectionLabel: "GitHub - GitHub Engineering",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
    parameters: [
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

function renderTriggerPicker(input: {
  hasConnectedIntegrations: boolean;
  selectedConnectionId: string;
  selectedTriggerIds: readonly string[];
  triggerParameterValues: Record<string, Record<string, string>>;
  disabledReason?: string | null;
  eventOptions?: readonly WebhookAutomationEventOption[];
  useStatefulSelection?: boolean;
}): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(["automation-trigger-parameters", input.selectedConnectionId, "user"], {
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
    const [selectedTriggerIds, setSelectedTriggerIds] = useState([...input.selectedTriggerIds]);

    return (
      <WebhookAutomationTriggerPicker
        error={undefined}
        eventOptions={input.eventOptions ?? WebhookEventOptions}
        hasConnectedIntegrations={input.hasConnectedIntegrations}
        {...(input.disabledReason === undefined ? {} : { disabledReason: input.disabledReason })}
        onTriggerParameterValueChange={() => {}}
        onValueChange={setSelectedTriggerIds}
        selectedConnectionId={input.selectedConnectionId}
        selectedTriggerIds={selectedTriggerIds}
        triggerParameterValues={input.triggerParameterValues}
      />
    );
  }

  return render(
    <QueryClientProvider client={queryClient}>
      {input.useStatefulSelection === true ? (
        <StatefulTriggerPicker />
      ) : (
        <WebhookAutomationTriggerPicker
          error={undefined}
          eventOptions={input.eventOptions ?? WebhookEventOptions}
          hasConnectedIntegrations={input.hasConnectedIntegrations}
          {...(input.disabledReason === undefined ? {} : { disabledReason: input.disabledReason })}
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
  it("groups available triggers by integration connection label", () => {
    expect(groupWebhookAutomationEventOptions(WebhookEventOptions)).toEqual([
      {
        connectionLabel: "GitHub - GitHub Engineering",
        logoKey: "github",
        items: [WebhookEventOptions[0], WebhookEventOptions[1]],
      },
    ]);
  });

  it("renders selected triggers with provider logos", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
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
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
          eventType: "github.push.deleted",
        }),
      ],
      triggerParameterValues: {},
    });

    expect(screen.getByText("icn_01kkk1g84mfetvga8a4b853k27::github.push.deleted")).toBeDefined();
    expect(screen.getByText("Unavailable")).toBeDefined();
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
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
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
      disabledReason: "The selected profile has no bindings with automation triggers.",
    });

    const input = container.querySelector('input[placeholder="No triggers available"]');
    if (input === null) {
      throw new Error("Expected trigger input.");
    }

    expect(input.getAttribute("disabled")).toBe("");
    expect(
      screen.getAllByText("The selected profile has no bindings with automation triggers.").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("No triggers added yet.")).toBeNull();
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

  it("renders selector-backed trigger parameters", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
          eventType: "github.pull_request.opened",
        }),
      ],
      triggerParameterValues: {
        [createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
          eventType: "github.pull_request.opened",
        })]: {
          author: "octocat",
        },
      },
    });

    expect(screen.getAllByDisplayValue("octocat").length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Any author")).toBeNull();
  });

  it("renders enum-backed trigger parameters", () => {
    renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
          eventType: "github.issue_comment.created",
        }),
      ],
      triggerParameterValues: {
        [createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
          eventType: "github.issue_comment.created",
        })]: {
          target: "exists",
        },
      },
    });

    expect(screen.getAllByText("pull request").length).toBeGreaterThan(0);
  });

  it("hides already selected triggers from the add-trigger list", () => {
    const { container } = renderTriggerPicker({
      hasConnectedIntegrations: true,
      selectedConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      selectedTriggerIds: [
        createWebhookAutomationTriggerId({
          connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
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
    expect(screen.getAllByText("GitHub - GitHub Engineering").length).toBeGreaterThan(0);
    expect(addTriggerInput.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("option", { name: "Issue comment created" }));

    expect(addTriggerInput.getAttribute("aria-expanded")).toBe("false");
    expect(
      within(container).getByRole("button", { name: "Remove Issue comment created trigger" }),
    ).toBeDefined();
  });

  it("resets unsaved resource query text when the selected value changes", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    queryClient.setQueryData(
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
        connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
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
      <QueryClientProvider client={queryClient}>
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
