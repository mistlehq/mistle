import { afterEach, describe, expect, it } from "vitest";

import {
  getDashboardBuildDriftSchemaMismatchPromptRevision,
  requestDashboardBuildDriftSchemaMismatchPrompt,
  resetDashboardBuildDriftForTest,
  resolveDashboardBuildDriftStatus,
} from "./dashboard-build-drift.js";

afterEach(() => {
  resetDashboardBuildDriftForTest();
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

describe("dashboard build drift schema mismatch prompt", () => {
  it("advances the prompt revision when a schema mismatch should be shown again", () => {
    const previousRevision = getDashboardBuildDriftSchemaMismatchPromptRevision();

    requestDashboardBuildDriftSchemaMismatchPrompt();

    expect(getDashboardBuildDriftSchemaMismatchPromptRevision()).toBe(previousRevision + 1);
  });
});
