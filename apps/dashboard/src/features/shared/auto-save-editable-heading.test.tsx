// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AutoSaveEditableHeading } from "./auto-save-editable-heading.js";

describe("AutoSaveEditableHeading", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a validation error and stays in edit mode when the value is invalid", async () => {
    render(
      <AutoSaveEditableHeading
        ariaLabel="Heading"
        editButtonLabel="Edit heading"
        initialValue="Repo Maintainer"
        onSave={async () => {}}
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={(nextValue) => {
          return nextValue.trim().length === 0 ? "Heading is required." : null;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit heading" }));
    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(await screen.findByText("Heading is required.")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Heading" })).toBeDefined();
  });

  it("returns to display mode after a successful save", async () => {
    render(
      <AutoSaveEditableHeading
        ariaLabel="Heading"
        editButtonLabel="Edit heading"
        initialValue="Repo Maintainer"
        onSave={async () => {}}
        successFadeDurationMs={20}
        successVisibleDurationMs={40}
        validate={() => null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit heading" }));
    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.blur(input);

    expect(screen.getByText("Saving")).toBeDefined();

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Heading" })).toBeNull();
    });

    expect(screen.getByText("New Title")).toBeDefined();
  });
});
