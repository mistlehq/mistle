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
    value: "github.issue_comment.created",
    label: "Issue comment created",
    category: "Issues",
    logoKey: "github",
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
    value: "github.pull_request.opened",
    label: "Pull request opened",
    category: "Pull requests",
    logoKey: "github",
  },
];

const FormValues: WebhookAutomationFormValues = {
  name: "Repo triage",
  integrationConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
  sandboxProfileId: "sbp_01kkk1mbmxfetvga8kcmw612jj",
  enabled: true,
  inputTemplate: "{}",
  conversationKeyTemplate: "{{payload.repository.full_name}}",
  idempotencyKeyTemplate: "",
  eventTypes: ["github.issue_comment.created"],
  triggerParameterValues: {},
  payloadFilterEditorMode: "builder",
  payloadFilterBuilderMode: "all",
  payloadFilterConditions: [],
  payloadFilterText: "",
};

describe("WebhookAutomationForm", () => {
  function renderForm(): void {
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
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );
  }

  it("shows selected option labels in the select triggers instead of raw ids", () => {
    renderForm();

    expect(screen.getByText("GitHub Engineering")).toBeDefined();
    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.queryByText("icn_01kkk1g84mfetvga8a4b853k27")).toBeNull();
    expect(screen.queryByText("sbp_01kkk1mbmxfetvga8kcmw612jj")).toBeNull();
  });

  it("shows selected trigger event labels instead of raw event types", () => {
    renderForm();

    expect(screen.getAllByText("Issue comment created").length).toBeGreaterThan(0);
    expect(screen.queryByText("github.issue_comment.created")).toBeNull();
  });
});
