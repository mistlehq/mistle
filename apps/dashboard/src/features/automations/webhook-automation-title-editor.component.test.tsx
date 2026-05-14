// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

describe("WebhookAutomationTitleEditor", () => {
  it("keeps the inline title field disabled while saves are disabled", () => {
    render(
      <WebhookAutomationTitleEditor
        disabled={true}
        errorMessage={undefined}
        onCommit={() => {}}
        title="Old trigger name"
      />,
    );

    expect(screen.getByRole("textbox", { name: "Trigger name" })).toHaveProperty("disabled", true);
  });

  it("resets the inline draft from a keyed remount when the title changes", () => {
    const { rerender } = render(
      <WebhookAutomationTitleEditor
        disabled={false}
        errorMessage={undefined}
        onCommit={() => {}}
        title="Old trigger name"
      />,
    );

    fireEvent.change(screen.getByLabelText("Trigger name"), {
      target: { value: "Unsaved title" },
    });

    rerender(
      <WebhookAutomationTitleEditor
        disabled={false}
        errorMessage={undefined}
        onCommit={() => {}}
        title="New trigger name"
      />,
    );

    expect(screen.queryByDisplayValue("Unsaved title")).toBeNull();

    expect(screen.getByDisplayValue("New trigger name")).toBeDefined();
  });
});
