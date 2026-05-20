// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardBuildDriftDialog } from "./dashboard-build-drift-dialog.js";

const DriftStatus = {
  kind: "drift",
  clientReleaseVersion: "0.18.1",
  serverReleaseVersion: "0.18.2",
} as const;

describe("DashboardBuildDriftDialog", () => {
  it("does not render when dashboard build drift is not known", () => {
    render(
      <DashboardBuildDriftDialog
        status={{ kind: "current", clientReleaseVersion: "0.18.1", serverReleaseVersion: "0.18.1" }}
      />,
    );

    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();
  });

  it("renders the refresh prompt when dashboard build drift is detected", () => {
    render(<DashboardBuildDriftDialog status={DriftStatus} />);

    expect(screen.getByRole("alertdialog", { name: "Refresh required" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("stays dismissed for the same detected release and reopens for a later release", () => {
    const { rerender } = render(<DashboardBuildDriftDialog status={DriftStatus} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();

    rerender(<DashboardBuildDriftDialog status={DriftStatus} />);
    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();

    rerender(
      <DashboardBuildDriftDialog
        status={{
          kind: "drift",
          clientReleaseVersion: "0.18.1",
          serverReleaseVersion: "0.18.3",
        }}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Refresh required" })).toBeTruthy();
  });

  it("keeps the same release dismissed after status returns to current", () => {
    const { rerender } = render(<DashboardBuildDriftDialog status={DriftStatus} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    rerender(
      <DashboardBuildDriftDialog
        status={{
          kind: "current",
          clientReleaseVersion: "0.18.2",
          serverReleaseVersion: "0.18.2",
        }}
      />,
    );
    rerender(<DashboardBuildDriftDialog status={DriftStatus} />);

    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();
  });

  it("renders the refresh prompt when the server release version is missing", () => {
    render(
      <DashboardBuildDriftDialog
        status={{
          kind: "drift",
          clientReleaseVersion: "0.18.1",
          serverReleaseVersion: null,
        }}
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "Refresh required" })).toBeTruthy();
  });
});
