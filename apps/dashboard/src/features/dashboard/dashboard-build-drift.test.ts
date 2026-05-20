import { describe, expect, it } from "vitest";

import {
  getDashboardBuildDriftStatus,
  resetDashboardBuildDriftForTest,
  resolveDashboardBuildDriftStatus,
} from "./dashboard-build-drift.js";

describe("getDashboardBuildDriftStatus", () => {
  it("returns a stable unknown status before a build drift check completes", () => {
    resetDashboardBuildDriftForTest();

    expect(getDashboardBuildDriftStatus()).toBe(getDashboardBuildDriftStatus());
  });
});

describe("resolveDashboardBuildDriftStatus", () => {
  it("reports current when dashboard and server release versions match", () => {
    expect(
      resolveDashboardBuildDriftStatus({
        clientReleaseVersion: "0.18.1",
        serverReleaseVersion: "0.18.1",
      }),
    ).toStrictEqual({
      kind: "current",
      clientReleaseVersion: "0.18.1",
      serverReleaseVersion: "0.18.1",
    });
  });

  it("reports drift when dashboard and server release versions differ", () => {
    expect(
      resolveDashboardBuildDriftStatus({
        clientReleaseVersion: "0.18.1",
        serverReleaseVersion: "0.18.2",
      }),
    ).toStrictEqual({
      kind: "drift",
      clientReleaseVersion: "0.18.1",
      serverReleaseVersion: "0.18.2",
    });
  });

  it("reports drift when a legacy server does not return a release version", () => {
    expect(
      resolveDashboardBuildDriftStatus({
        clientReleaseVersion: "0.18.1",
        serverReleaseVersion: null,
      }),
    ).toStrictEqual({
      kind: "drift",
      clientReleaseVersion: "0.18.1",
      serverReleaseVersion: null,
    });
  });
});
