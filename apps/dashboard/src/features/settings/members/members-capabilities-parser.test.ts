import { describe, expect, it } from "vitest";

import { parseMembershipCapabilities } from "./members-capabilities-parser.js";

describe("members capabilities parser", () => {
  it("parses valid capabilities payloads", () => {
    const parsed = parseMembershipCapabilities({
      organizationId: "org_123",
      actorRole: "owner,member",
      invite: {
        canExecute: true,
        assignableRoles: ["owner", "admin", "member"],
      },
      memberRoleUpdate: {
        canExecute: true,
        roleTransitionMatrix: {
          owner: ["owner", "admin", "member"],
          admin: ["admin", "member"],
          member: ["member"],
        },
      },
    });

    expect(parsed).toEqual({
      organizationId: "org_123",
      actorRole: "owner",
      invite: {
        canExecute: true,
        assignableRoles: ["owner", "admin", "member"],
      },
      memberRoleUpdate: {
        canExecute: true,
        roleTransitionMatrix: {
          owner: ["owner", "admin", "member"],
          admin: ["admin", "member"],
          member: ["member"],
        },
      },
    });
  });

  it("returns null when required payload fields are missing", () => {
    expect(parseMembershipCapabilities({})).toBeNull();
    expect(
      parseMembershipCapabilities({
        organizationId: "org_123",
        actorRole: "owner",
      }),
    ).toBeNull();
  });

  it("returns null when role arrays are not arrays", () => {
    expect(
      parseMembershipCapabilities({
        organizationId: "org_123",
        actorRole: "owner",
        invite: {
          canExecute: true,
          assignableRoles: null,
        },
        memberRoleUpdate: {
          canExecute: true,
          roleTransitionMatrix: {
            owner: ["owner", "admin", "member"],
            admin: ["admin", "member"],
            member: ["member"],
          },
        },
      }),
    ).toBeNull();

    expect(
      parseMembershipCapabilities({
        organizationId: "org_123",
        actorRole: "owner",
        invite: {
          canExecute: true,
          assignableRoles: ["owner", "admin", "member"],
        },
        memberRoleUpdate: {
          canExecute: true,
          roleTransitionMatrix: {
            owner: ["owner", "admin", "member"],
            admin: ["admin", "member"],
            member: "member",
          },
        },
      }),
    ).toBeNull();
  });

  it("returns null when invite assignable roles include an unknown role", () => {
    expect(
      parseMembershipCapabilities({
        organizationId: "org_123",
        actorRole: "owner",
        invite: {
          canExecute: true,
          assignableRoles: ["owner", "viewer"],
        },
        memberRoleUpdate: {
          canExecute: true,
          roleTransitionMatrix: {
            owner: ["owner", "admin", "member"],
            admin: ["admin", "member"],
            member: ["member"],
          },
        },
      }),
    ).toBeNull();
  });

  it("returns null when role transition matrix includes an unknown role", () => {
    expect(
      parseMembershipCapabilities({
        organizationId: "org_123",
        actorRole: "owner",
        invite: {
          canExecute: true,
          assignableRoles: ["owner", "admin", "member"],
        },
        memberRoleUpdate: {
          canExecute: true,
          roleTransitionMatrix: {
            owner: ["owner", "admin", "member"],
            admin: ["admin", "viewer"],
            member: ["member"],
          },
        },
      }),
    ).toBeNull();
  });
});
