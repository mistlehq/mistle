// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { DefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";
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
  inputTemplate: "Please review the changes made.\n\nPayload:\n{{payload}}",
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
  function buildFormValues(
    overrides: Partial<WebhookAutomationFormValues> = {},
  ): WebhookAutomationFormValues {
    return {
      ...FormValues,
      ...overrides,
    };
  }

  function getResetButton(): HTMLElement {
    const resetButton = screen.getAllByRole("button", { name: "Reset to default" }).at(-1);

    if (resetButton === undefined) {
      throw new Error("Expected reset button to be rendered.");
    }

    return resetButton;
  }

  function renderForm(mode: "create" | "edit" = "create"): void {
    renderFormWithOptions({
      mode,
    });
  }

  function renderFormWithOptions(input: {
    mode?: "create" | "edit";
    values?: WebhookAutomationFormValues;
    triggerPickerDisabledReason?: string | null;
    webhookEventOptions?: typeof WebhookEventOptions;
    onValueChange?: (
      key: keyof WebhookAutomationFormValues,
      value: string | boolean | string[] | Record<string, Record<string, string>>,
    ) => void;
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
          onValueChange={input.onValueChange ?? (() => {})}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledReason={input.triggerPickerDisabledReason ?? null}
          webhookEventOptions={input.webhookEventOptions ?? WebhookEventOptions}
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
      values: buildFormValues({
        triggerIds: [],
        conversationKeyTemplate: "",
      }),
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

  it("shows the agent instructions editor copy", () => {
    renderForm("create");

    expect(screen.getByLabelText("Agent Instructions")).toBeDefined();
    expect(
      screen.getAllByText((content) => content.includes("Use Liquid syntax with")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("{{webhookEvent.eventType}}").length).toBeGreaterThan(0);
    expect(screen.getAllByText("{{payload}}").length).toBeGreaterThan(0);
    expect(screen.queryByText("Basics")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Agent Instructions" })).toBeNull();
  });

  it("renders triggers before agent instructions", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const [triggersHeading] = screen.getAllByRole("heading", { name: "Triggers" });
    const inputTemplateField = screen.getByLabelText("Agent Instructions");

    if (triggersHeading === undefined) {
      throw new Error("Expected triggers heading to be rendered.");
    }

    expect(
      Boolean(
        triggersHeading.compareDocumentPosition(inputTemplateField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(container.textContent?.indexOf("Triggers")).toBeLessThan(
      container.textContent?.indexOf("Agent Instructions") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("disables reset when the default template is already shown", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        inputTemplate: DefaultWebhookAutomationInputTemplate,
      }),
    });

    expect(getResetButton().hasAttribute("disabled")).toBe(true);
  });

  it("resets the template field to the default", () => {
    let nextInputTemplate: string | null = null;

    renderFormWithOptions({
      mode: "create",
      onValueChange(key, value) {
        if (key !== "inputTemplate") {
          return;
        }

        if (typeof value !== "string") {
          throw new Error("Expected input template reset value to be a string.");
        }

        nextInputTemplate = value;
      },
    });

    fireEvent.click(getResetButton());
    expect(nextInputTemplate).toBe(DefaultWebhookAutomationInputTemplate);
  });

  it("renders a fixed create title and a separate automation name field", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        name: "",
      }),
    });
    const form = within(container);

    expect(form.getAllByRole("heading", { name: "Create Automation" }).length).toBeGreaterThan(0);
    expect(form.getByText("Automation name")).toBeDefined();
    expect(form.queryByDisplayValue("Your automation")).toBeNull();
    expect(form.queryByRole("button", { name: "Edit automation name" })).toBeNull();
  });

  it("shows the selected-profile trigger binding message when triggers are unavailable", () => {
    renderFormWithOptions({
      mode: "create",
      triggerPickerDisabledReason: "The selected profile has no bindings with automation triggers.",
      webhookEventOptions: [],
      values: buildFormValues({
        triggerIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(
      screen.getAllByText("The selected profile has no bindings with automation triggers.").length,
    ).toBeGreaterThan(0);
  });
});
