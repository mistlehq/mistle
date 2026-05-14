// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ToolbarSearchInput } from "./toolbar-search-input.js";

it("uses the default h-9 input size for toolbar search fields", () => {
  const { container } = render(
    <ToolbarSearchInput
      ariaLabel="Search triggers"
      onValueChange={() => {}}
      placeholder="Search triggers"
      value=""
    />,
  );

  const input = screen.getByRole("textbox", { name: "Search triggers" });
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
      ariaLabel="Search triggers"
      onValueChange={(value) => {
        nextValue = value;
      }}
      placeholder="Search triggers"
      value=""
    />,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "Search triggers" }), {
    target: { value: "backlog" },
  });

  expect(nextValue).toBe("backlog");
});
