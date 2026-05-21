// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { TriggerFormShellStatusMessage } from "./trigger-form-shell.js";
import type { WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import type { WebhookTriggerEventParameterRuleMap } from "./webhook-trigger-event-types.js";
import {
  WebhookTriggerForm,
  type WebhookTriggerFormOption,
  type WebhookTriggerFormValues,
} from "./webhook-trigger-form.js";
import { createWebhookTriggerEventId } from "./webhook-trigger-option-builders.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  GitHubConnectionId,
  GitHubConnectionLabel,
  GitHubWebhookSourceId,
  RepoMaintainerSandboxProfileId,
} from "./webhook-trigger-test-fixtures.js";

const ConnectionOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: GitHubConnectionId,
    label: GitHubConnectionLabel,
    description: "github-cloud",
  },
];

const SandboxProfileOptions: readonly WebhookTriggerFormOption[] = [
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

const FormValues: WebhookTriggerFormValues = {
  name: "Repo triage",
  sandboxProfileId: RepoMaintainerSandboxProfileId,
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  inputTemplate: "Please review the changes made.\n\nPayload:\n{{payload}}",
  instructions: "Reply tersely and mention the review checklist.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  eventIds: [
    createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    }),
  ],
  eventParameterRules: {},
};

const TestQueryClient = createTestQueryClient();

const PrimaryRepositoryOptions: readonly WebhookTriggerFormOption[] = [
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

describe("WebhookTriggerForm", () => {
  function buildFormValues(
    overrides: Partial<WebhookTriggerFormValues> = {},
  ): WebhookTriggerFormValues {
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
              eventIds: [],
              eventParameterRules: {},
            }
          : FormValues,
    });
  }

  function renderFormWithOptions(input: {
    mode?: "create" | "edit";
    values?: WebhookTriggerFormValues;
    triggerPickerDisabledState?: WebhookTriggerEventPickerDisabledState | null;
    sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
    webhookEventOptions?: typeof WebhookEventOptions;
    primaryRepositoryOptions?: readonly WebhookTriggerFormOption[];
    onValueChange?: (
      key: keyof WebhookTriggerFormValues,
      value: string | boolean | string[] | WebhookTriggerEventParameterRuleMap,
    ) => void;
  }): ReturnType<typeof render> {
    return render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
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
          {...(input.sandboxProfileStatusMessage === undefined
            ? {}
            : { sandboxProfileStatusMessage: input.sandboxProfileStatusMessage })}
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
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(within(container).queryByText("Group events by")).toBeNull();
  });

  it("shows the message template and agent instructions editors", () => {
    const { container } = renderForm("create");
    const currentForm = within(container);

    expect(currentForm.getByRole("textbox", { name: "User message" })).toBeDefined();
    expect(
      currentForm.getByRole("textbox", { name: "Agent Instructions for Trigger" }),
    ).toBeDefined();
    const editors = container.querySelectorAll('[data-slot="agent-instructions-editor"]');
    const messageTemplateEditor = editors[0];

    if (!(messageTemplateEditor instanceof HTMLElement)) {
      throw new Error("Expected the message template editor to be rendered.");
    }

    expect(messageTemplateEditor.getAttribute("data-editor-state")).toBe("empty");
    expect(currentForm.queryByRole("heading", { name: "User message" })).toBeNull();
  });

  it("renders events before the agent instructions editor and message template editor", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const currentForm = within(container);
    const [eventsHeading] = currentForm.getAllByRole("heading", { name: "When this happens" });
    const triggerInstructionsField = currentForm.getByRole("textbox", {
      name: "Agent Instructions for Trigger",
    });
    const inputTemplateField = currentForm.getByRole("textbox", { name: "User message" });

    if (eventsHeading === undefined) {
      throw new Error("Expected events heading to be rendered.");
    }

    expect(
      Boolean(
        eventsHeading.compareDocumentPosition(triggerInstructionsField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        triggerInstructionsField.compareDocumentPosition(inputTemplateField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(container.textContent?.indexOf("When this happens")).toBeLessThan(
      container.textContent?.indexOf("Agent Instructions for Trigger") ?? Number.POSITIVE_INFINITY,
    );
    expect(container.textContent?.indexOf("Agent Instructions for Trigger")).toBeLessThan(
      container.textContent?.indexOf("User message") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("renders the trigger name field without an inline edit-name control on create", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        name: "",
      }),
    });
    const form = within(container);
    const triggerNameInput = form.getAllByRole("textbox")[0];

    if (triggerNameInput === undefined) {
      throw new Error("Expected trigger name input to be rendered.");
    }

    expect(triggerNameInput).toBeDefined();
    expect(form.queryByDisplayValue("Your trigger")).toBeNull();
    expect(form.queryByRole("button", { name: "Edit trigger name" })).toBeNull();
  });

  it("shows the selected-profile trigger binding message when triggers are unavailable", () => {
    renderFormWithOptions({
      mode: "create",
      triggerPickerDisabledState: {
        reason:
          "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
        variant: "default",
      },
      webhookEventOptions: [],
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(
      screen.getAllByText(
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows sandbox profile status messages above the form fields", () => {
    renderFormWithOptions({
      mode: "create",
      sandboxProfileStatusMessage: {
        message:
          "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
        variant: "alert",
      },
      triggerPickerDisabledState: {
        reason: "Select a sandbox profile with an active version to choose events.",
        variant: "default",
      },
      webhookEventOptions: [],
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    const profileMessage = screen.getByText(
      "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
    );
    const sandboxProfileLabel = screen.getByText("Sandbox profile");
    const eventsMessage = screen.getByText(
      "Select a sandbox profile with an active version to choose events.",
    );

    expect(profileMessage.compareDocumentPosition(sandboxProfileLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(profileMessage.compareDocumentPosition(eventsMessage)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("marks invalid controls with aria-invalid when field errors are present", () => {
    const { container } = render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{
            name: "Trigger name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            conversationKeyTemplate: "Select a supported conversation grouping.",
            inputTemplate: "User message is required.",
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
    const triggerNameInput = currentForm.getByDisplayValue("Repo triage");
    const inputTemplateEditor = currentForm.getByRole("textbox", { name: "User message" });

    expect(triggerNameInput.getAttribute("aria-invalid")).toBe("true");
    expect(inputTemplateEditor.getAttribute("aria-invalid")).toBe("true");

    const invalidSelectTriggers = [
      ...container.querySelectorAll('[data-slot="select-trigger"]'),
    ].filter((selectTrigger) => selectTrigger.getAttribute("aria-invalid") === "true");
    expect(invalidSelectTriggers).toHaveLength(2);
  });

  it("shows the required-fields summary and inline copy for generic input template errors", () => {
    render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{
            name: "Trigger name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            eventIds: "Please add an event",
            inputTemplate: "User message is required.",
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
            eventIds: [],
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.queryByText("Trigger name is required.")).toBeNull();
    expect(screen.queryByText("Select a sandbox profile.")).toBeNull();
    expect(screen.getAllByText("User message is required.").length).toBeGreaterThan(0);
    expect(screen.getByText("Please add an event")).toBeDefined();
  });

  it("shows save failures at the top of the form", () => {
    const { container } = render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          fieldErrors={{}}
          formError="The selected events do not support this trigger setup."
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

    expect(currentForm.getByText("Trigger could not be saved")).toBeDefined();
    expect(
      currentForm.getByText("The selected events do not support this trigger setup."),
    ).toBeDefined();
  });

  it("shows the no-trigger helper copy under the message template editor", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(screen.getAllByText("Select an event to insert event fields.").length).toBeGreaterThan(
      0,
    );
  });
});
