import { render, screen } from "@testing-library/react";

import { SidebarInset } from "./sidebar.js";

it("renders SidebarInset with a min width shrink guard", () => {
  render(<SidebarInset>Content</SidebarInset>);

  expect(screen.getByText("Content").closest("main")).toHaveClass("min-w-0");
});
