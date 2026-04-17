import { render, screen } from "@testing-library/react";

import { ScreenActionButton } from "./screen-action-button.js";

it("renders a full-width screen action button", () => {
  render(<ScreenActionButton>Continue</ScreenActionButton>);

  const button = screen.getByRole("button", { name: "Continue" });
  expect(button.className).toContain("h-12");
  expect(button.className).toContain("w-full");
  expect(button.className).toContain("text-sm");
});

it("keeps screen action styling while allowing additional classes", () => {
  render(
    <ScreenActionButton className="text-zinc-500 hover:text-zinc-700" variant="link">
      Use a different email
    </ScreenActionButton>,
  );

  const button = screen.getByRole("button", { name: "Use a different email" });
  expect(button.className).toContain("h-12");
  expect(button.className).toContain("text-zinc-500");
});
