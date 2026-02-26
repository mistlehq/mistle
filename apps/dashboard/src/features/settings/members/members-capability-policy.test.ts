import { describe, expect, it } from "vitest";

import {
  buildRoleChangeDialogState,
  canManageInvitations,
  resolveAllowedRoleTransitions,
} from "./members-capability-policy.js";

describe("members capability policy", () => {
  it("returns false for invitation management when capabilities are unavailable", () => {
    expect(canManageInvitations(null)).toBe(false);
  });

  it("returns invitation management execution capability", () => {
    expect(
      canManageInvitations({
        organizationId: "org_1",
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
            member: ["member"],
          },
        },
      }),
    ).toBe(true);
  });

  it("resolves allowed role transitions by current member role", () => {
    const allowed = resolveAllowedRoleTransitions({
      capabilities: {
        organizationId: "org_1",
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
      },
      memberRole: "member",
    });

    expect(allowed).toEqual(["admin", "member"]);
  });

  it("builds role-change dialog state when transitions are available", () => {
    const nextRoleChangeDialog = buildRoleChangeDialogState({
      capabilities: {
        organizationId: "org_1",
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
      },
      member: {
        id: "mem_1",
        userId: "usr_1",
        name: "A Member",
        email: "member@example.com",
        role: "member",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(nextRoleChangeDialog).toEqual({
      member: {
        id: "mem_1",
        userId: "usr_1",
        name: "A Member",
        email: "member@example.com",
        role: "member",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
      selectedRole: "admin",
      allowedRoles: ["admin", "member"],
    });
  });

  it("returns null dialog state when no transitions are allowed", () => {
    const nextRoleChangeDialog = buildRoleChangeDialogState({
      capabilities: {
        organizationId: "org_1",
        actorRole: "owner",
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
      },
      member: {
        id: "mem_1",
        userId: "usr_1",
        name: "Owner",
        email: "owner@example.com",
        role: "owner",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(nextRoleChangeDialog).toBeNull();
  });
});
