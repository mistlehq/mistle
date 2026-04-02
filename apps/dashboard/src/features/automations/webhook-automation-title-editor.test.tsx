// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

describe("WebhookAutomationTitleEditor", () => {
  it("disables edit entry while saves are disabled", () => {
    render(
      <WebhookAutomationTitleEditor
        errorMessage={undefined}
        onCommit={() => {}}
        saveDisabled={true}
        title="Old automation name"
      />,
    );

    expect(screen.getByRole("button", { name: "Edit automation name" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("resets edit state from a keyed remount when the title changes", () => {
    const { rerender } = render(
      <WebhookAutomationTitleEditor
        errorMessage={undefined}
        onCommit={() => {}}
        saveDisabled={false}
        title="Old automation name"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit automation name" }));
    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Unsaved title" },
    });

    rerender(
      <WebhookAutomationTitleEditor
        errorMessage={undefined}
        onCommit={() => {}}
        saveDisabled={false}
        title="New automation name"
      />,
    );

    expect(screen.queryByDisplayValue("Unsaved title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit automation name" }));

    expect(screen.getByDisplayValue("New automation name")).toBeDefined();
  });
});
