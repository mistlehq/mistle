// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionApiKeyDialog } from "./integration-connection-api-key-dialog.js";

describe("IntegrationConnectionApiKeyDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a password input and emits value changes", () => {
    let updatedValue = "";

    render(
      <IntegrationConnectionApiKeyDialog
        connectionDisplayName="OpenAI Production"
        isOpen={true}
        isPending={false}
        onClose={() => {}}
        onSubmit={() => {}}
        onValueChange={(nextValue) => {
          updatedValue = nextValue;
        }}
        value=""
      />,
    );

    expect(screen.getByText("Update OpenAI Production")).toBeTruthy();
    const input = screen.getByPlaceholderText("Enter new API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
    fireEvent.change(input, {
      target: { value: "sk-test-key" },
    });
    expect(updatedValue).toBe("sk-test-key");
  });
});
