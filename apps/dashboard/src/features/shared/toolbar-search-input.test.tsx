// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ToolbarSearchInput } from "./toolbar-search-input.js";

afterEach(() => {
  cleanup();
});

it("uses the default h-9 input size for toolbar search fields", () => {
  const { container } = render(
    <ToolbarSearchInput
      ariaLabel="Search automations"
      onValueChange={() => {}}
      placeholder="Search automations"
      value=""
    />,
  );

  const input = screen.getByRole("textbox", { name: "Search automations" });
  const group = container.firstElementChild;

  if (!(group instanceof HTMLElement)) {
    throw new Error("Expected the toolbar search wrapper to render.");
  }

  expect(group.className).not.toContain("h-10");
  expect(input.className).toContain("h-9");
  expect(input.className).toContain("pl-10");
});

it("forwards search value changes", () => {
  let nextValue = "";

  render(
    <ToolbarSearchInput
      ariaLabel="Search automations"
      onValueChange={(value) => {
        nextValue = value;
      }}
      placeholder="Search automations"
      value=""
    />,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "Search automations" }), {
    target: { value: "backlog" },
  });

  expect(nextValue).toBe("backlog");
});
