import { describe, expect, it } from "vitest";

import {
  buildMembershipCapabilities,
  canManageOrganization,
  getOrganizationPermissions,
  getInviteAssignableRoles,
  getRoleTransitionMatrix,
  hasTriggerCreatePermission,
  hasTriggerDeletePermission,
  hasTriggerReadPermission,
  hasTriggerUpdatePermission,
  OrganizationPermissions,
  hasOrganizationPermission,
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

  describe("canManageOrganization", () => {
    it("allows organization management for owner and admin only", () => {
      expect(canManageOrganization("owner")).toBe(true);
      expect(canManageOrganization("admin")).toBe(true);
      expect(canManageOrganization("member")).toBe(false);
    });
  });

  describe("organization permissions", () => {
    it("grants membership read without membership management to members", () => {
      expect(getOrganizationPermissions("member")).toContain(
        OrganizationPermissions.ORGANIZATION_MEMBERSHIP_READ,
      );
      expect(
        hasOrganizationPermission("member", OrganizationPermissions.ORGANIZATION_MEMBERSHIP_READ),
      ).toBe(true);
      expect(
        hasOrganizationPermission("member", OrganizationPermissions.ORGANIZATION_MEMBERSHIP_CREATE),
      ).toBe(false);
      expect(
        hasOrganizationPermission("member", OrganizationPermissions.ORGANIZATION_MEMBERSHIP_UPDATE),
      ).toBe(false);
    });

    it("grants generic trigger permissions to organization roles", () => {
      expect(getOrganizationPermissions("owner")).toEqual(
        expect.arrayContaining([
          OrganizationPermissions.TRIGGER_READ,
          OrganizationPermissions.TRIGGER_CREATE,
          OrganizationPermissions.TRIGGER_UPDATE,
          OrganizationPermissions.TRIGGER_DELETE,
        ]),
      );
      expect(getOrganizationPermissions("member")).toEqual(
        expect.arrayContaining([
          OrganizationPermissions.TRIGGER_READ,
          OrganizationPermissions.TRIGGER_CREATE,
          OrganizationPermissions.TRIGGER_UPDATE,
          OrganizationPermissions.TRIGGER_DELETE,
        ]),
      );
    });

    it("matches trigger access with generic and legacy webhook trigger permissions", () => {
      expect(hasTriggerReadPermission([OrganizationPermissions.TRIGGER_READ])).toBe(true);
      expect(hasTriggerReadPermission([OrganizationPermissions.TRIGGER_WEBHOOK_READ])).toBe(true);
      expect(hasTriggerReadPermission([OrganizationPermissions.SANDBOX_PROFILE_READ])).toBe(false);

      expect(hasTriggerCreatePermission([OrganizationPermissions.TRIGGER_CREATE])).toBe(true);
      expect(hasTriggerCreatePermission([OrganizationPermissions.TRIGGER_WEBHOOK_CREATE])).toBe(
        true,
      );
      expect(hasTriggerCreatePermission([OrganizationPermissions.SANDBOX_PROFILE_CREATE])).toBe(
        false,
      );

      expect(hasTriggerUpdatePermission([OrganizationPermissions.TRIGGER_UPDATE])).toBe(true);
      expect(hasTriggerUpdatePermission([OrganizationPermissions.TRIGGER_WEBHOOK_UPDATE])).toBe(
        true,
      );
      expect(hasTriggerUpdatePermission([OrganizationPermissions.SANDBOX_PROFILE_UPDATE])).toBe(
        false,
      );

      expect(hasTriggerDeletePermission([OrganizationPermissions.TRIGGER_DELETE])).toBe(true);
      expect(hasTriggerDeletePermission([OrganizationPermissions.TRIGGER_WEBHOOK_DELETE])).toBe(
        true,
      );
      expect(hasTriggerDeletePermission([OrganizationPermissions.SANDBOX_PROFILE_DELETE])).toBe(
        false,
      );
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
