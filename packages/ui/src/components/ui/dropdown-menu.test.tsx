import { render, screen } from "@testing-library/react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

it("renders default dropdown items with mobile-sized touch targets", () => {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<button type="button" />}>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Terminal</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  const item = screen.getByText("Terminal");

  expect(item.className).toContain("min-h-11");
  expect(item.className).toContain("text-base");
  expect(item.className).toContain("md:min-h-0");
  expect(item.className).toContain("md:text-sm");
});

it("renders submenu triggers with mobile-sized touch targets", () => {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<button type="button" />}>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Switch organization</DropdownMenuSubTrigger>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  const trigger = screen.getByText("Switch organization");

  expect(trigger.className).toContain("min-h-11");
  expect(trigger.className).toContain("text-base");
  expect(trigger.className).toContain("md:text-sm");
});

it("renders selectable dropdown items with room for their indicators", () => {
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<button type="button" />}>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem checked>Show terminal</DropdownMenuCheckboxItem>
        <DropdownMenuRadioGroup value="mistle">
          <DropdownMenuRadioItem value="mistle">Mistle</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  const checkboxItem = screen.getByText("Show terminal");
  const radioItem = screen.getByText("Mistle");

  expect(checkboxItem.className).toContain("min-h-11");
  expect(checkboxItem.className).toContain("pr-10");
  expect(checkboxItem.className).toContain("md:pr-8");
  expect(radioItem.className).toContain("min-h-11");
  expect(radioItem.className).toContain("pr-10");
  expect(radioItem.className).toContain("md:pr-8");
});
