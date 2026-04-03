// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

afterEach(cleanup);

describe("WebhookAutomationTitleEditor", () => {
  it("disables edit entry while saves are disabled", () => {
    render(
      <WebhookAutomationTitleEditor
        disabled={true}
        errorMessage={undefined}
        onCommit={() => {}}
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
        disabled={false}
        errorMessage={undefined}
        onCommit={() => {}}
        title="Old automation name"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit automation name" }));
    fireEvent.change(screen.getByLabelText("Automation name"), {
      target: { value: "Unsaved title" },
    });

    rerender(
      <WebhookAutomationTitleEditor
        disabled={false}
        errorMessage={undefined}
        onCommit={() => {}}
        title="New automation name"
      />,
    );

    expect(screen.queryByDisplayValue("Unsaved title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit automation name" }));

    expect(screen.getByDisplayValue("New automation name")).toBeDefined();
  });
});
