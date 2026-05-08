// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SessionsNavToggleItem } from "./sessions-nav-toggle-item.js";

function renderItem(input: { checked: boolean }): void {
  render(
    <SidebarProvider>
      <MemoryRouter>
        <SessionsNavToggleItem checked={input.checked} onCheckedChange={() => undefined} />
      </MemoryRouter>
    </SidebarProvider>,
  );
}

describe("SessionsNavToggleItem", () => {
  it("routes to the sessions list page when sidebar mode is disabled", () => {
    renderItem({
      checked: false,
    });

    expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe("/sessions");
  });

  it("routes to the dedicated sessions page when sidebar mode is enabled", () => {
    renderItem({
      checked: true,
    });

    expect(screen.getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe(
      "/sessions/new",
    );
  });
});
