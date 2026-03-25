// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WebhookAutomationForm,
  resolveConversationKeyFieldOptions,
  type WebhookAutomationEventOption,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-list-helpers.js";

const ConnectionOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "icn_01kkk1g84mfetvga8a4b853k27",
    label: "GitHub Engineering",
    description: "github-cloud",
  },
];

const SandboxProfileOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "sbp_01kkk1mbmxfetvga8kcmw612jj",
    label: "Repo Maintainer",
    description: "Latest version pinned at runtime",
  },
];

const WebhookEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    id: createWebhookAutomationTriggerId({
      connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      eventType: "github.issue_comment.created",
    }),
    eventType: "github.issue_comment.created",
    connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
    connectionLabel: "GitHub Engineering",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
    conversationKeyOptions: [
      {
        id: "issue",
        label: "Issue",
        description: "Events from the same issue go to the same conversation.",
        template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      },
      {
        id: "repository",
        label: "Repository",
        description: "Events from the same repository go to the same conversation.",
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
    ],
  },
  {
    id: createWebhookAutomationTriggerId({
      connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      eventType: "github.pull_request.opened",
    }),
    eventType: "github.pull_request.opened",
    connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
    connectionLabel: "GitHub Engineering",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
    conversationKeyOptions: [
      {
        id: "pull-request",
        label: "Pull request",
        description: "Events from the same pull request go to the same conversation.",
        template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
      },
      {
        id: "repository",
        label: "Repository",
        description: "Events from the same repository go to the same conversation.",
        template: "{{payload.repository.full_name}}",
      },
    ],
  },
];

const FormValues: WebhookAutomationFormValues = {
  name: "Repo triage",
  sandboxProfileId: "sbp_01kkk1mbmxfetvga8kcmw612jj",
  enabled: true,
  instructions: "Please review the changes made.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  triggerIds: [
    createWebhookAutomationTriggerId({
      connectionId: "icn_01kkk1g84mfetvga8a4b853k27",
      eventType: "github.issue_comment.created",
    }),
  ],
  triggerParameterValues: {},
};

describe("WebhookAutomationForm", () => {
  function renderForm(mode: "create" | "edit" = "create"): void {
    renderFormWithOptions({
      mode,
    });
  }

  function renderFormWithOptions(input: {
    mode?: "create" | "edit";
    values?: WebhookAutomationFormValues;
  }): ReturnType<typeof render> {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{}}
          formError={null}
          isDeleting={false}
          isSaving={false}
          mode={input.mode ?? "create"}
          onDelete={(input.mode ?? "create") === "edit" ? () => {} : null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledReason={null}
          webhookEventOptions={WebhookEventOptions}
          values={input.values ?? FormValues}
        />
      </QueryClientProvider>,
    );
  }

  it("shows selected option labels in the select triggers instead of raw ids", () => {
    renderForm();

    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.queryByText("icn_01kkk1g84mfetvga8a4b853k27")).toBeNull();
    expect(screen.queryByText("sbp_01kkk1mbmxfetvga8kcmw612jj")).toBeNull();
  });

  it("shows selected trigger event labels instead of raw event types", () => {
    renderForm();

    expect(screen.getAllByText("Issue comment created").length).toBeGreaterThan(0);
    expect(screen.queryByText("github.issue_comment.created")).toBeNull();
  });

  it("hides the automation enabled field on create", () => {
    renderForm("create");

    expect(screen.queryByLabelText("Automation enabled")).toBeNull();
  });

  it("shows the automation enabled field on edit", () => {
    renderForm("edit");

    expect(screen.getByRole("switch", { name: "Automation enabled" })).toBeDefined();
  });

  it("shows connector-defined conversation grouping choices", () => {
    renderForm("create");

    expect(screen.getAllByText("Group events by").length).toBeGreaterThan(0);
  });

  it("hides conversation grouping when no triggers are selected", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: {
        ...FormValues,
        triggerIds: [],
        conversationKeyTemplate: "",
      },
    });

    expect(container.textContent?.includes("Group events by")).toBe(false);
  });

  it("does not inject an unsupported current conversation grouping option", () => {
    const fieldOptions = resolveConversationKeyFieldOptions({
      selectedEventOptions: [WebhookEventOptions[0]!],
      currentTemplate: "{{payload.unsupported}}",
    });

    expect(fieldOptions.hasUnsupportedCurrentTemplate).toBe(true);
    expect(fieldOptions.selectedTemplate).toBe("");
    expect(
      fieldOptions.options.some((option) => option.label === "Current setting (unsupported)"),
    ).toBe(false);
  });

  it("shows the instructions editor copy", () => {
    renderForm("create");

    expect(screen.getByLabelText("Agent Instructions")).toBeDefined();
    expect(
      screen.getAllByText(
        "These instructions are sent together with the webhook payload and event type.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Basics")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Agent Instructions" })).toBeNull();
  });

  it("renders triggers before instructions", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const [triggersHeading] = screen.getAllByRole("heading", { name: "Triggers" });
    const instructionsField = screen.getByLabelText("Agent Instructions");

    if (triggersHeading === undefined) {
      throw new Error("Expected triggers heading to be rendered.");
    }

    expect(
      Boolean(
        triggersHeading.compareDocumentPosition(instructionsField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(container.textContent?.indexOf("Triggers")).toBeLessThan(
      container.textContent?.indexOf("Agent Instructions") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("renders a fixed create title and a separate automation name field", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });
    const form = within(container);

    expect(form.getAllByRole("heading", { name: "Create Automation" }).length).toBeGreaterThan(0);
    expect(form.getByText("Automation name")).toBeDefined();
    expect(form.getByDisplayValue("Repo triage")).toBeDefined();
    expect(form.queryByRole("button", { name: "Edit automation name" })).toBeNull();
  });

  it("shows the selected-profile trigger binding message when triggers are unavailable", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{}}
          formError={null}
          isDeleting={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledReason={
            "The selected profile has no bindings with automation triggers."
          }
          webhookEventOptions={[]}
          values={{
            ...FormValues,
            triggerIds: [],
            conversationKeyTemplate: "",
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getAllByText("The selected profile has no bindings with automation triggers.").length,
    ).toBeGreaterThan(0);
  });
});
