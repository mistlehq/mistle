import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupTextarea } from "./input-group.js";

function renderSearchGroup(active: boolean): HTMLElement {
  const { container } = render(
    <InputGroup active={active} variant="inline">
      <InputGroupAddon>
        <MagnifyingGlassIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search sessions"
        placeholder="Search sessions"
        variant="inline"
      />
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
  const input = screen.getByRole("textbox", { name: "Search sessions" });

  expect(group).not.toHaveAttribute("data-active");
  expect(group.className).toContain("border-transparent");
  expect(group.className).toContain("hover:border-border");
  expect(group.className).toContain("text-foreground");
  expect(group.className).toContain("h-9");
  expect(input.className).toContain("h-full");
  expect(input.className).toContain("border-0");
});

it("renders the search appearance in the active state", () => {
  const group = renderSearchGroup(true);
  const input = screen.getByRole("textbox", { name: "Search sessions" });

  expect(group).toHaveAttribute("data-active", "true");
  expect(group.className).toContain("border-border");
  expect(group.className).toContain("bg-white");
  expect(group.className).toContain("text-sidebar-accent-foreground");
  expect(group.className).toContain("h-9");
  expect(input.className).toContain("h-full");
  expect(input.className).toContain("border-0");
});

it("keeps the default input variant stripped inside the group chrome", () => {
  render(
    <InputGroup>
      <InputGroupAddon>@</InputGroupAddon>
      <InputGroupInput aria-label="Workspace handle" defaultValue="platform-team" />
      <InputGroupAddon align="inline-end">.mistle.dev</InputGroupAddon>
    </InputGroup>,
  );

  const input = screen.getByRole("textbox", { name: "Workspace handle" });

  expect(input.className).toContain("border-0");
  expect(input.className).toContain("rounded-none");
  expect(input.className).toContain("px-0");
  expect(input.className).toContain("shadow-none");
});

it("lets the default group wrapper expand for textareas", () => {
  const { container } = render(
    <InputGroup>
      <InputGroupAddon align="block-start">Review notes</InputGroupAddon>
      <InputGroupTextarea
        aria-label="Review notes body"
        rows={4}
        defaultValue="Flag the auth flow."
      />
      <InputGroupAddon align="block-end">Saved</InputGroupAddon>
    </InputGroup>,
  );

  const group = container.querySelector('[data-slot="input-group"]');
  if (!(group instanceof HTMLElement)) {
    throw new Error("Expected the input group wrapper to render.");
  }

  expect(group.className).toContain("has-[>textarea]:h-auto");
});
