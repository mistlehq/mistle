// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignerSessionPendingPage } from "./designer-session-page.js";

describe("DesignerSessionPendingPage", () => {
  it("renders stable Designer chrome without chat preparation status", () => {
    render(
      <SidebarProvider>
        <DesignerSessionPendingPage />
      </SidebarProvider>,
    );

    expect(screen.getByText("Designer")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Preparing chat" })).toBeNull();
  });
});
