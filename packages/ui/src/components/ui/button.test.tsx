import { render, screen } from "@testing-library/react";

import { Button } from "./button.js";

it("renders a clickable button", () => {
  render(<Button>Launch</Button>);

  expect(screen.getByRole("button", { name: /launch/i })).toBeInTheDocument();
});
