import { render, screen } from "@testing-library/react";

import { Input } from "./input.js";

it("renders the default input appearance", () => {
  render(<Input aria-label="Name" placeholder="Organization name" />);

  const input = screen.getByRole("textbox", { name: "Name" });
  expect(input.className).toContain("border-input");
  expect(input.className).toContain("h-9");
});

it("renders the inline input appearance", () => {
  render(<Input aria-label="Search sessions" placeholder="Search sessions" variant="inline" />);

  const input = screen.getByRole("textbox", { name: "Search sessions" });
  expect(input.className).toContain("border-transparent");
  expect(input.className).toContain("h-9");
  expect(input.className).toContain("text-sm");
  expect(input.className).toContain("hover:border-border");
});
