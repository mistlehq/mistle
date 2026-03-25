// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WebhookAutomationForm,
  resolveConversationKeyFieldOptions,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubConnectionLabel,
  RepoMaintainerSandboxProfileId,
} from "./webhook-automation-test-fixtures.js";

const ConnectionOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: GitHubConnectionId,
    label: GitHubConnectionLabel,
    description: "github-cloud",
  },
];

const SandboxProfileOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: RepoMaintainerSandboxProfileId,
    label: "Repo Maintainer",
    description: "Latest version pinned at runtime",
  },
];

const WebhookEventOptions = [
  createGithubIssueCommentCreatedEventOption({
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
  }),
  createGithubPullRequestOpenedEventOption(),
];

const FormValues: WebhookAutomationFormValues = {
  name: "Repo triage",
  sandboxProfileId: RepoMaintainerSandboxProfileId,
  enabled: true,
  instructions: "Please review the changes made.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  triggerIds: [
    createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
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
    expect(screen.queryByText(GitHubConnectionId)).toBeNull();
    expect(screen.queryByText(RepoMaintainerSandboxProfileId)).toBeNull();
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
      values: {
        ...FormValues,
        name: "",
      },
    });
    const form = within(container);

    expect(form.getAllByRole("heading", { name: "Create Automation" }).length).toBeGreaterThan(0);
    expect(form.getByText("Automation name")).toBeDefined();
    expect(form.queryByDisplayValue("Your automation")).toBeNull();
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

  it("marks invalid controls with aria-invalid when field errors are present", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{
            name: "Automation name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            conversationKeyTemplate: "Select a supported conversation grouping.",
            instructions: "Instructions are required.",
          }}
          formError={null}
          isDeleting={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledReason={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    const currentForm = within(container);
    const automationNameInput = currentForm.getByDisplayValue("Repo triage");
    const instructionsTextarea = currentForm.getByDisplayValue("Please review the changes made.");

    expect(automationNameInput.getAttribute("aria-invalid")).toBe("true");
    expect(instructionsTextarea.getAttribute("aria-invalid")).toBe("true");

    const selectTriggers = container.querySelectorAll('[data-slot="select-trigger"]');
    expect(selectTriggers[0]?.getAttribute("aria-invalid")).toBe("true");
    expect(selectTriggers[1]?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelectorAll('[data-invalid="true"]').length).toBe(4);
  });
});
