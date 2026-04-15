// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditableHeading } from "./editable-heading.js";

describe("EditableHeading", () => {
  afterEach(() => {
    cleanup();
  });

  function renderEditableHeading(
    overrides: Partial<Parameters<typeof EditableHeading>[0]> = {},
  ): ReturnType<typeof render> {
    return render(
      <EditableHeading
        ariaLabel="Heading"
        cancelOnEscape={true}
        draftValue="Draft value"
        editButtonLabel="Edit heading"
        errorMessage={undefined}
        isEditing={false}
        maxWidthClassName={undefined}
        onCancel={() => {}}
        onCommit={() => {}}
        onDraftValueChange={() => {}}
        onEditStart={() => {}}
        placeholder="Heading"
        disabled={false}
        value="Saved value"
        {...overrides}
      />,
    );
  }

  it("disables the edit button when saves are disabled", () => {
    renderEditableHeading({
      disabled: true,
    });

    expect(screen.getByRole("button", { name: "Edit heading" })).toHaveProperty("disabled", true);
  });

  it("disables the textbox while editing when saves are disabled", () => {
    renderEditableHeading({
      isEditing: true,
      disabled: true,
    });

    expect(screen.getByRole("textbox", { name: "Heading" })).toHaveProperty("disabled", true);
    expect(
      screen
        .getByRole("textbox", { name: "Heading" })
        .closest("[data-save-state]")
        ?.getAttribute("data-save-state"),
    ).toBe("idle");
  });

  it("renders the edit field with bottom-only page-title chrome", () => {
    renderEditableHeading({
      isEditing: true,
    });

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(input.className).toContain("border-x-0");
    expect(input.className).toContain("border-t-0");
    expect(input.className).toContain("px-0");
    expect(input.className).toContain("text-xl");
  });

  it("commits on blur and cancels on escape", () => {
    let commitCount = 0;
    let cancelCount = 0;

    renderEditableHeading({
      isEditing: true,
      onCancel: () => {
        cancelCount += 1;
      },
      onCommit: () => {
        commitCount += 1;
      },
    });

    const input = screen.getByRole("textbox", { name: "Heading" });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Escape" });

    expect(commitCount).toBe(1);
    expect(cancelCount).toBe(1);
  });

  it("renders an always-editable inline field with flush border treatment", () => {
    renderEditableHeading({
      alwaysEditing: true,
    });

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(screen.queryByRole("button", { name: "Edit heading" })).toBeNull();
    expect(input.className).toContain("border-x-0");
    expect(input.className).toContain("border-t-0");
    expect(input.className).toContain("px-0");
    expect(input.className).toContain("hover:border-b-border");
  });
});
