import { describe, expect, it } from "vitest";

import {
  ControlPlaneTypeIdPrefixes,
  createBetterAuthControlPlaneTypeId,
  createControlPlaneTypeId,
} from "./ids.js";

function expectTypeIdPrefix(identifier: string, prefix: string): void {
  expect(identifier).toMatch(new RegExp(`^${prefix}_[0-9a-z]{26}$`, "u"));
}

describe("control plane ids", () => {
  it("creates control-plane typeids with the requested prefix", () => {
    expectTypeIdPrefix(
      createControlPlaneTypeId(ControlPlaneTypeIdPrefixes.ORGANIZATION),
      ControlPlaneTypeIdPrefixes.ORGANIZATION,
    );
    expectTypeIdPrefix(
      createControlPlaneTypeId(ControlPlaneTypeIdPrefixes.USER),
      ControlPlaneTypeIdPrefixes.USER,
    );
  });

  it("maps Better Auth model names to the control-plane typeid prefixes", () => {
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("accounts"),
      ControlPlaneTypeIdPrefixes.ACCOUNT,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("users"),
      ControlPlaneTypeIdPrefixes.USER,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("sessions"),
      ControlPlaneTypeIdPrefixes.SESSION,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("verifications"),
      ControlPlaneTypeIdPrefixes.VERIFICATION,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("organizations"),
      ControlPlaneTypeIdPrefixes.ORGANIZATION,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("members"),
      ControlPlaneTypeIdPrefixes.MEMBER,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("invitations"),
      ControlPlaneTypeIdPrefixes.INVITATION,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("teams"),
      ControlPlaneTypeIdPrefixes.TEAM,
    );
    expectTypeIdPrefix(
      createBetterAuthControlPlaneTypeId("teamMembers"),
      ControlPlaneTypeIdPrefixes.TEAM_MEMBER,
    );
  });

  it("fails fast for unsupported Better Auth models", () => {
    expect(() => createBetterAuthControlPlaneTypeId("unknown")).toThrow(
      "Unsupported Better Auth model 'unknown' for control-plane TypeID generation.",
    );
  });
});
