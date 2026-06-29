// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignerSessionLoadingPage } from "./designer-session-page.js";

describe("DesignerSessionLoadingPage", () => {
  it("renders a visible workspace preparation state", () => {
    render(
      <SidebarProvider>
        <DesignerSessionLoadingPage />
      </SidebarProvider>,
    );

    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Preparing chat" })).toBeTruthy();
  });
});
