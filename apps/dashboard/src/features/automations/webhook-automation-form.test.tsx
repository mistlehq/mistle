// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WebhookAutomationForm,
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
        label: "Per issue thread",
        description: "All matching events for the same issue go to one conversation.",
        template: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
      },
      {
        id: "repository",
        label: "Per repository",
        description: "All matching events in the same repository go to one conversation.",
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
        label: "Per pull request",
        description: "All matching events for the same pull request go to one conversation.",
        template: "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}",
      },
      {
        id: "repository",
        label: "Per repository",
        description: "All matching events in the same repository go to one conversation.",
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

  function renderFormWithOptions(input: { mode?: "create" | "edit" }): ReturnType<typeof render> {
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
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
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

    expect(screen.getByRole("checkbox", { name: "Automation enabled" })).toBeDefined();
  });

  it("shows connector-defined conversation grouping choices", () => {
    renderForm("create");

    expect(screen.getAllByText("Conversation grouping").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Events that render to the same key are routed into the same conversation.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows the instructions editor copy", () => {
    renderForm("create");

    expect(screen.getByLabelText("Instructions")).toBeDefined();
    expect(
      screen.getAllByText(
        "The automation will always receive your instructions, the webhook event type, and the full webhook payload.",
      ).length,
    ).toBeGreaterThan(0);
  });
});
