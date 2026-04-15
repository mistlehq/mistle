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

  it("renders the edit field with inline input chrome", () => {
    const { container } = renderEditableHeading({
      editVariant: "inline",
    });

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(screen.queryByRole("button", { name: "Edit heading" })).toBeNull();
    expect(input.className).toContain("border-0");
    expect(input.className).toContain("border-b");
    expect(input.className).toContain("border-transparent");
    expect(input.className).toContain("w-auto");
    expect(input.className).toContain("pl-0");
    expect(input.className).toContain("pr-2");
    expect(input.className).toContain("text-xl");
    expect(input.className).toContain("font-semibold");
    expect(input.className).toContain("leading-none");
    expect(input.getAttribute("size")).toBe("11");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("hides the pencil while the inline field is active", () => {
    const { container } = renderEditableHeading({
      editVariant: "inline",
    });

    const pencil = container.querySelector("svg");
    expect(pencil).not.toBeNull();
    expect(pencil?.parentElement?.className).toContain("group-focus-within:opacity-0");
    expect(pencil?.parentElement?.className).toContain("group-hover:opacity-0");
  });

  it("renders the edit field with the default page-title chrome", () => {
    renderEditableHeading({
      editVariant: "default",
      isEditing: true,
    });

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(input.className).toContain("border-input");
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
});
