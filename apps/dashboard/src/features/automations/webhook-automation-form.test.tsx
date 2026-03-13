// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WebhookAutomationForm,
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

const FormValues: WebhookAutomationFormValues = {
  name: "Repo triage",
  integrationConnectionId: "icn_01kkk1g84mfetvga8a4b853k27",
  sandboxProfileId: "sbp_01kkk1mbmxfetvga8kcmw612jj",
  enabled: true,
  inputTemplate: "{}",
  conversationKeyTemplate: "{{payload.repository.full_name}}",
  idempotencyKeyTemplate: "",
  eventTypesText: "push",
  payloadFilterText: "",
};

describe("WebhookAutomationForm", () => {
  it("shows selected option labels in the select triggers instead of raw ids", () => {
    render(
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
        values={FormValues}
      />,
    );

    expect(screen.getByText("GitHub Engineering")).toBeDefined();
    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.queryByText("icn_01kkk1g84mfetvga8a4b853k27")).toBeNull();
    expect(screen.queryByText("sbp_01kkk1mbmxfetvga8kcmw612jj")).toBeNull();
  });
});
