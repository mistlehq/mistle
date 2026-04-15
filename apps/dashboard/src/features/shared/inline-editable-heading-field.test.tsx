// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InlineEditableHeadingField } from "./inline-editable-heading-field.js";

describe("InlineEditableHeadingField", () => {
  afterEach(() => {
    cleanup();
  });

  function renderInlineEditableHeadingField(
    overrides: Partial<Parameters<typeof InlineEditableHeadingField>[0]> = {},
  ): ReturnType<typeof render> {
    return render(
      <InlineEditableHeadingField
        ariaLabel="Heading"
        cancelOnEscape={true}
        disabled={false}
        draftValue="Draft value"
        errorMessage={undefined}
        inputClassName={undefined}
        maxWidthClassName={undefined}
        onCancel={() => {}}
        onCommit={() => {}}
        onDraftValueChange={() => {}}
        onFocus={() => {}}
        placeholder="Heading"
        saveStatus="idle"
        {...overrides}
      />,
    );
  }

  it("disables the textbox while editing when saves are disabled", () => {
    renderInlineEditableHeadingField({
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
    renderInlineEditableHeadingField();

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(input.className).toContain("border-x-0");
    expect(input.className).toContain("border-t-0");
    expect(input.className).toContain("px-0");
    expect(input.className).toContain("text-xl");
  });

  it("commits on blur and cancels on escape", () => {
    let commitCount = 0;
    let cancelCount = 0;

    renderInlineEditableHeadingField({
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

  it("renders an inline field with flush border treatment", () => {
    renderInlineEditableHeadingField();

    const input = screen.getByRole("textbox", { name: "Heading" });

    expect(input.className).toContain("border-x-0");
    expect(input.className).toContain("border-t-0");
    expect(input.className).toContain("px-0");
    expect(input.className).toContain("hover:border-b-border");
  });

  it("focuses the input when the pencil affordance is clicked", () => {
    let focusCount = 0;
    const { container } = renderInlineEditableHeadingField({
      onFocus: () => {
        focusCount += 1;
      },
    });

    const input = screen.getByRole("textbox", { name: "Heading" });
    const iconTrigger = container.querySelector(".cursor-text");
    if (!(iconTrigger instanceof HTMLElement)) {
      throw new Error("Expected the pencil affordance to render.");
    }

    fireEvent.mouseDown(iconTrigger);

    expect(document.activeElement).toBe(input);
    expect(focusCount).toBe(1);
  });
});
