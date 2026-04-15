import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { render } from "@testing-library/react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group.js";

function renderSearchGroup(active: boolean): HTMLElement {
  const { container } = render(
    <InputGroup active={active} variant="inline">
      <InputGroupAddon>
        <MagnifyingGlassIcon />
      </InputGroupAddon>
      <InputGroupInput aria-label="Search sessions" placeholder="Search sessions" />
    </InputGroup>,
  );

  const group = container.querySelector('[data-slot="input-group"]');
  if (!(group instanceof HTMLElement)) {
    throw new Error("Expected the input group wrapper to render.");
  }

  return group;
}

it("renders the search appearance in the inactive state", () => {
  const group = renderSearchGroup(false);

  expect(group).not.toHaveAttribute("data-active");
  expect(group.className).toContain("border-transparent");
  expect(group.className).toContain("hover:border-border");
  expect(group.className).toContain("text-foreground");
});

it("renders the search appearance in the active state", () => {
  const group = renderSearchGroup(true);

  expect(group).toHaveAttribute("data-active", "true");
  expect(group.className).toContain("border-border");
  expect(group.className).toContain("bg-white");
  expect(group.className).toContain("text-sidebar-accent-foreground");
});
