// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
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
import type { WebhookAutomationTriggerPickerDisabledState } from "./webhook-automation-trigger-picker-state.js";

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
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  inputTemplate: "Please review the changes made.\n\nPayload:\n{{payload}}",
  instructions: "Reply tersely and mention the review checklist.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  triggerIds: [
    createWebhookAutomationTriggerId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    }),
  ],
  triggerParameterValues: {},
};

const TestQueryClient = createTestQueryClient();

const PrimaryRepositoryOptions: readonly WebhookAutomationFormOption[] = [
  {
    value: "__workspace_root__",
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
];

afterEach(() => {
  TestQueryClient.clear();
  cleanup();
});

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
              primaryRepositoryId: "",
              inputTemplate: "",
              instructions: "",
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
    primaryRepositoryOptions?: readonly WebhookAutomationFormOption[];
    onValueChange?: (
      key: keyof WebhookAutomationFormValues,
      value:
        | string
        | boolean
        | string[]
        | Record<string, Record<string, string>>
        | Record<string, Record<string, boolean>>,
    ) => void;
  }): ReturnType<typeof render> {
    return render(
      <QueryClientProvider client={TestQueryClient}>
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
          {...(input.primaryRepositoryOptions === undefined
            ? {}
            : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
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
      primaryRepositoryOptions: PrimaryRepositoryOptions,
      values: buildFormValues(),
    });

    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Primary repository" })).toHaveProperty(
      "value",
      "mistlehq/platform",
    );
    expect(screen.getByText("/root/mistlehq/platform")).toBeDefined();
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

  it("shows the message template and automation instructions editors", () => {
    const { container } = renderForm("create");
    const currentForm = within(container);

    expect(currentForm.getByRole("textbox", { name: "Message Template" })).toBeDefined();
    expect(
      currentForm.getByRole("textbox", { name: "Agent Instructions for Automation" }),
    ).toBeDefined();
    const editors = container.querySelectorAll('[data-slot="agent-instructions-editor"]');
    const messageTemplateEditor = editors[0];

    if (!(messageTemplateEditor instanceof HTMLElement)) {
      throw new Error("Expected the message template editor to be rendered.");
    }

    expect(messageTemplateEditor.getAttribute("data-editor-state")).toBe("empty");
    expect(currentForm.queryByRole("heading", { name: "Message Template" })).toBeNull();
  });

  it("renders triggers before the automation instructions editor and message template editor", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const currentForm = within(container);
    const [triggersHeading] = currentForm.getAllByRole("heading", { name: "Triggers" });
    const automationInstructionsField = currentForm.getByRole("textbox", {
      name: "Agent Instructions for Automation",
    });
    const inputTemplateField = currentForm.getByRole("textbox", { name: "Message Template" });

    if (triggersHeading === undefined) {
      throw new Error("Expected triggers heading to be rendered.");
    }

    expect(
      Boolean(
        triggersHeading.compareDocumentPosition(automationInstructionsField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        automationInstructionsField.compareDocumentPosition(inputTemplateField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(container.textContent?.indexOf("Triggers")).toBeLessThan(
      container.textContent?.indexOf("Agent Instructions for Automation") ??
        Number.POSITIVE_INFINITY,
    );
    expect(container.textContent?.indexOf("Agent Instructions for Automation")).toBeLessThan(
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
      <QueryClientProvider client={TestQueryClient}>
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
      <QueryClientProvider client={TestQueryClient}>
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
            primaryRepositoryId: "",
            triggerIds: [],
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.queryByText("Automation name is required.")).toBeNull();
    expect(screen.queryByText("Select a sandbox profile.")).toBeNull();
    expect(screen.getAllByText("Input template is required.").length).toBeGreaterThan(0);
    expect(screen.getByText("Please add a trigger")).toBeDefined();
  });

  it("shows save failures at the top of the form", () => {
    const { container } = render(
      <QueryClientProvider client={TestQueryClient}>
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

  it("shows the no-trigger helper copy under the message template editor", () => {
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
});
