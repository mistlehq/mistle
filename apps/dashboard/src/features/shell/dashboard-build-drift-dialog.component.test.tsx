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
  it("does not render before a schema mismatch prompt is requested", () => {
    render(<DashboardBuildDriftDialog schemaMismatchPromptRevision={0} status={DriftStatus} />);

    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();
  });

  it("renders the refresh prompt when schema mismatch confirms dashboard build drift", () => {
    render(<DashboardBuildDriftDialog schemaMismatchPromptRevision={1} status={DriftStatus} />);

    expect(screen.getByRole("alertdialog", { name: "Refresh required" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("stays dismissed for the same prompt revision and reopens for a later schema mismatch", () => {
    const { rerender } = render(
      <DashboardBuildDriftDialog schemaMismatchPromptRevision={1} status={DriftStatus} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();

    rerender(<DashboardBuildDriftDialog schemaMismatchPromptRevision={1} status={DriftStatus} />);
    expect(screen.queryByRole("alertdialog", { name: "Refresh required" })).toBeNull();

    rerender(<DashboardBuildDriftDialog schemaMismatchPromptRevision={2} status={DriftStatus} />);
    expect(screen.getByRole("alertdialog", { name: "Refresh required" })).toBeTruthy();
  });
});
