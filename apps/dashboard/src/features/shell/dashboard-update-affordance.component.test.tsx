// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardUpdateAffordance } from "./dashboard-update-affordance.js";

describe("DashboardUpdateAffordance", () => {
  it("renders no sidebar action when dashboard build drift is not known", () => {
    render(
      <SidebarProvider>
        <DashboardUpdateAffordance
          status={{
            kind: "current",
            clientReleaseVersion: "0.18.1",
            serverReleaseVersion: "0.18.1",
          }}
        />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("button", { name: "Refresh required. Refresh dashboard" })).toBe(
      null,
    );
  });

  it("renders the update action when dashboard build drift is known", () => {
    render(
      <SidebarProvider>
        <DashboardUpdateAffordance
          status={{
            kind: "drift",
            clientReleaseVersion: "0.18.1",
            serverReleaseVersion: "0.18.2",
          }}
        />
      </SidebarProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Refresh required. Refresh dashboard" }),
    ).toBeTruthy();
    expect(screen.getByText("Refresh required")).toBeTruthy();
  });
});
