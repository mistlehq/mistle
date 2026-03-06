// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const dialog: IntegrationConnectionDialogState = {
  displayName: "OpenAI",
  methods: [IntegrationConnectionMethodIds.API_KEY, IntegrationConnectionMethodIds.OAUTH],
  mode: "create",
  targetKey: "openai",
};

describe("IntegrationConnectionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables 1Password autofill for API key input", () => {
    render(
      <IntegrationConnectionDialog
        apiKeyValue=""
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.API_KEY}
        dialog={dialog}
        onApiKeyChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSubmit={() => {}}
        pending={false}
      />,
    );

    const input = screen.getByPlaceholderText("Enter API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });
});
