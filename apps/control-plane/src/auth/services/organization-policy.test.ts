import { describe, expect, it } from "vitest";

import {
  buildMembershipCapabilities,
  getInviteAssignableRoles,
  getRoleTransitionMatrix,
  parseOrganizationRole,
} from "./organization-policy.js";

describe("organization policy", () => {
  describe("parseOrganizationRole", () => {
    it("parses direct roles", () => {
      expect(parseOrganizationRole("owner")).toBe("owner");
      expect(parseOrganizationRole("admin")).toBe("admin");
      expect(parseOrganizationRole("member")).toBe("member");
    });

    it("parses legacy comma-separated roles by highest privilege", () => {
      expect(parseOrganizationRole("member,admin")).toBe("admin");
      expect(parseOrganizationRole("member, owner")).toBe("owner");
      expect(parseOrganizationRole("member")).toBe("member");
    });

    it("returns null for unknown roles", () => {
      expect(parseOrganizationRole("viewer")).toBeNull();
      expect(parseOrganizationRole("")).toBeNull();
    });
  });

  describe("getInviteAssignableRoles", () => {
    it("returns assignable roles by actor role", () => {
      expect(getInviteAssignableRoles("owner")).toEqual(["owner", "admin", "member"]);
      expect(getInviteAssignableRoles("admin")).toEqual(["admin", "member"]);
      expect(getInviteAssignableRoles("member")).toEqual([]);
    });
  });

  describe("getRoleTransitionMatrix", () => {
    it("returns full transitions for owner", () => {
      expect(getRoleTransitionMatrix("owner")).toEqual({
        owner: ["owner", "admin", "member"],
        admin: ["owner", "admin", "member"],
        member: ["owner", "admin", "member"],
      });
    });

    it("returns limited transitions for admin", () => {
      expect(getRoleTransitionMatrix("admin")).toEqual({
        owner: [],
        admin: ["admin", "member"],
        member: ["admin", "member"],
      });
    });

    it("returns no transitions for member", () => {
      expect(getRoleTransitionMatrix("member")).toEqual({
        owner: [],
        admin: [],
        member: [],
      });
    });
  });

  describe("buildMembershipCapabilities", () => {
    it("builds the expected capabilities shape", () => {
      expect(
        buildMembershipCapabilities({
          actorRole: "admin",
          organizationId: "org_123",
        }),
      ).toEqual({
        organizationId: "org_123",
        actorRole: "admin",
        invite: {
          canExecute: true,
          assignableRoles: ["admin", "member"],
        },
        memberRoleUpdate: {
          canExecute: true,
          roleTransitionMatrix: {
            owner: [],
            admin: ["admin", "member"],
            member: ["admin", "member"],
          },
        },
      });
    });
  });
});
