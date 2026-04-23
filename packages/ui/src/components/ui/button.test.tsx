// @vitest-environment jsdom

import { ArrowCircleUpIcon } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Button } from "./button.js";

it("renders a clickable button", () => {
  render(<Button>Launch</Button>);

  expect(screen.getByRole("button", { name: /launch/i })).toBeTruthy();
});

it("supports the icon-fill button size", () => {
  render(
    <Button aria-label="Send" size="icon-fill">
      <ArrowCircleUpIcon weight="fill" />
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Send" });
  expect(button.className).toContain("size-9");
  expect(button.className).toContain("overflow-hidden");
});

it("supports the info variant", () => {
  render(<Button variant="info">Show helper</Button>);

  const button = screen.getByRole("button", { name: "Show helper" });
  expect(button.className).toContain("bg-blue-600");
  expect(button.className).toContain("text-white");
});
