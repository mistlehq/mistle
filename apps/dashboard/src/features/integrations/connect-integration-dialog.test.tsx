// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConnectIntegrationDialog,
  ConnectMethodIds,
  type ConnectDialogState,
} from "./connect-integration-dialog.js";

const dialog: ConnectDialogState = {
  displayName: "OpenAI",
  methods: [ConnectMethodIds.API_KEY, ConnectMethodIds.OAUTH],
  targetKey: "openai",
};

describe("ConnectIntegrationDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables 1Password autofill for API key input", () => {
    render(
      <ConnectIntegrationDialog
        apiKeyValue=""
        connectError={null}
        connectMethodId={ConnectMethodIds.API_KEY}
        dialog={dialog}
        onApiKeyChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSubmit={() => {}}
        pending={false}
      />,
    );

    const input = screen.getByPlaceholderText("sk-...");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });
});
