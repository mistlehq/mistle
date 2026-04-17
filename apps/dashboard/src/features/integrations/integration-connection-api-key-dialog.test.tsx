// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationConnectionApiKeyDialog } from "./integration-connection-api-key-dialog.js";

describe("IntegrationConnectionApiKeyDialog", () => {
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

    const input = screen.getByPlaceholderText("Enter new API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
    fireEvent.change(input, {
      target: { value: "sk-test-key" },
    });
    expect(updatedValue).toBe("sk-test-key");
  });

  it("does not resubmit while a key update is pending", () => {
    let submitCount = 0;

    render(
      <IntegrationConnectionApiKeyDialog
        connectionDisplayName="OpenAI Production"
        isOpen={true}
        isPending={true}
        onClose={() => {}}
        onSubmit={() => {
          submitCount += 1;
        }}
        onValueChange={() => {}}
        value="sk-test-key"
      />,
    );

    const dialog = screen.getByRole("dialog");
    const form = dialog.querySelector("form");

    if (form === null) {
      throw new Error("Expected dialog form.");
    }

    fireEvent.submit(form);

    expect(submitCount).toBe(0);
  });
});
