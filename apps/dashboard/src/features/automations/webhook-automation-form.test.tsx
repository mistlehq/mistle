// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { resolveConversationKeyFieldOptions } from "./webhook-automation-conversation-key-field.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationFormOption,
  type WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubConnectionLabel,
  GitHubWebhookSourceId,
  RepoMaintainerSandboxProfileId,
} from "./webhook-automation-test-fixtures.js";
import type { WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker.js";

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
  inputTemplate: "Event type: {{webhookEvent.eventType}}\nPayload: {{payload}}",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  triggerIds: [
    createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
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

  function renderForm(mode: "create" | "edit" = "create"): ReturnType<typeof render> {
    return renderFormWithOptions({
      mode,
      values:
        mode === "create"
          ? {
              ...FormValues,
              name: "",
              sandboxProfileId: "",
              inputTemplate: "",
              conversationKeyTemplate: "",
              triggerIds: [],
              triggerParameterValues: {},
            }
          : FormValues,
    });
  }

  function renderFormWithOptions(input: {
    mode?: "create" | "edit";
    values?: WebhookAutomationFormValues;
    triggerPickerDisabledState?: WebhookAutomationTriggerPickerDisabledState | null;
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
          validationSummaryError={null}
          isDeleting={false}
          isSaving={false}
          mode={input.mode ?? "create"}
          onDelete={(input.mode ?? "create") === "edit" ? () => {} : null}
          onSubmit={() => {}}
          onValueChange={input.onValueChange ?? (() => {})}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={input.triggerPickerDisabledState ?? null}
          webhookEventOptions={input.webhookEventOptions ?? WebhookEventOptions}
          values={input.values ?? FormValues}
        />
      </QueryClientProvider>,
    );
  }

  it("shows selected option labels in the select triggers instead of raw ids", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues(),
    });

    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.queryByText(GitHubConnectionId)).toBeNull();
    expect(screen.queryByText(RepoMaintainerSandboxProfileId)).toBeNull();
  });

  it("shows selected trigger event labels instead of raw event types", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues(),
    });

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
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues(),
    });

    const groupingFieldCandidate = within(container)
      .getAllByText("Group events by")[0]
      ?.closest('[role="group"]');
    if (groupingFieldCandidate === null) {
      throw new Error("Expected conversation grouping field.");
    }
    if (!(groupingFieldCandidate instanceof HTMLElement)) {
      throw new Error("Expected conversation grouping field.");
    }

    expect(within(groupingFieldCandidate).getByRole("combobox")).toBeDefined();
  });

  it("hides conversation grouping when no triggers are selected", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        triggerIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(within(container).queryByText("Group events by")).toBeNull();
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
    const { container } = renderForm("create");
    const currentForm = within(container);

    expect(currentForm.getByRole("textbox", { name: "Message Template" })).toBeDefined();
    const editor = container.querySelector('[data-slot="agent-instructions-editor"]');

    if (editor === null) {
      throw new Error("Expected the agent instructions editor to be rendered.");
    }

    expect(editor.getAttribute("data-editor-state")).toBe("empty");
    expect(currentForm.queryByRole("heading", { name: "Message Template" })).toBeNull();
  });

  it("renders triggers before agent instructions", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const currentForm = within(container);
    const [triggersHeading] = currentForm.getAllByRole("heading", { name: "Triggers" });
    const inputTemplateField = currentForm.getByRole("textbox", { name: "Message Template" });

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
      container.textContent?.indexOf("Message Template") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("renders the automation name field without an inline edit-name control on create", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        name: "",
      }),
    });
    const form = within(container);
    const automationNameInput = form.getAllByRole("textbox")[0];

    if (automationNameInput === undefined) {
      throw new Error("Expected automation name input to be rendered.");
    }

    expect(automationNameInput).toBeDefined();
    expect(form.queryByDisplayValue("Your automation")).toBeNull();
    expect(form.queryByRole("button", { name: "Edit automation name" })).toBeNull();
  });

  it("shows the selected-profile trigger binding message when triggers are unavailable", () => {
    renderFormWithOptions({
      mode: "create",
      triggerPickerDisabledState: {
        reason: "The selected profile has no bindings with automation triggers.",
        variant: "default",
      },
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

  it("marks invalid controls with aria-invalid when field errors are present", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{
            name: "Automation name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            conversationKeyTemplate: "Select a supported conversation grouping.",
            inputTemplate: "Input template is required.",
          }}
          formError={null}
          validationSummaryError={null}
          isDeleting={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    const currentForm = within(container);
    const automationNameInput = currentForm.getByDisplayValue("Repo triage");
    const inputTemplateEditor = currentForm.getByRole("textbox", { name: "Message Template" });

    expect(automationNameInput.getAttribute("aria-invalid")).toBe("true");
    expect(inputTemplateEditor.getAttribute("aria-invalid")).toBe("true");

    const selectTriggers = container.querySelectorAll('[data-slot="select-trigger"]');
    expect(selectTriggers[0]?.getAttribute("aria-invalid")).toBe("true");
    expect(selectTriggers[1]?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the required-fields summary and inline copy for generic input template errors", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{
            name: "Automation name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            triggerIds: "Please add a trigger",
            inputTemplate: "Input template is required.",
          }}
          formError={null}
          validationSummaryError="Please address the fields highlighted in red."
          isDeleting={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={{
            ...FormValues,
            name: "",
            sandboxProfileId: "",
            triggerIds: [],
            inputTemplate: "",
            conversationKeyTemplate: "",
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.queryByText("Automation name is required.")).toBeNull();
    expect(screen.queryByText("Select a sandbox profile.")).toBeNull();
    expect(screen.getByText("Input template is required.")).toBeDefined();
    expect(screen.getByText("Please add a trigger")).toBeDefined();
  });

  it("shows save failures at the top of the form", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WebhookAutomationForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{}}
          formError="The selected triggers do not support this automation setup."
          validationSummaryError={null}
          isDeleting={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    const currentForm = within(container);

    expect(currentForm.getByText("Automation could not be saved")).toBeDefined();
    expect(
      currentForm.getByText("The selected triggers do not support this automation setup."),
    ).toBeDefined();
  });

  it("shows the no-trigger helper copy under the message template", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        triggerIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(screen.getAllByText("Select a trigger to insert event fields.").length).toBeGreaterThan(
      0,
    );
  });

  it("builds agent instruction tokens from the selected trigger payload paths", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [WebhookEventOptions[0]!],
    });

    expect(tokens.some((token) => token.path === "payload.repository.full_name")).toBe(true);
    expect(tokens.some((token) => token.path === "webhookEvent.eventType")).toBe(true);
    expect(tokens.some((token) => token.path === "automationRun.id")).toBe(true);
  });
});
