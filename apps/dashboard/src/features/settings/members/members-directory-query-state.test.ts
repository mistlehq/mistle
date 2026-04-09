import { describe, expect, it } from "vitest";

import type { MembershipCapabilities, SettingsMember } from "./members-api.js";
import { resolveMembersDirectoryQueryState } from "./members-directory-query-state.js";

function createMembershipCapabilities(): MembershipCapabilities {
  return {
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
  };
}

function createMember(name: string): SettingsMember {
  return {
    id: `mem_${name}`,
    userId: `user_${name}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    role: "member",
    joinedAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("resolveMembersDirectoryQueryState", () => {
  it("keeps stale rows visible and exposes a non-blocking refetch error", () => {
    const state = resolveMembersDirectoryQueryState({
      activeFilter: "members",
      capabilitiesQuery: {
        data: createMembershipCapabilities(),
        isError: false,
        isPending: false,
      } as never,
      invitationsQuery: {
        data: undefined,
        isError: false,
        isFetching: false,
        isPending: false,
      } as never,
      membersQuery: {
        data: {
          members: [createMember("Storybook Tester")],
          memberAvatarsByUserId: new Map(),
          limit: 25,
          offset: 0,
          total: 1,
        },
        error: new Error("boom"),
        isError: true,
        isFetching: true,
        isPending: false,
      } as never,
    });

    expect(state.isPageLoading).toBe(false);
    expect(state.loadErrorMessage).toBeNull();
    expect(state.listErrorNoticeMessage).toBe("boom");
    expect(state.members).toEqual([createMember("Storybook Tester")]);
  });

  it("returns a blocking load error for the initial list failure", () => {
    const state = resolveMembersDirectoryQueryState({
      activeFilter: "members",
      capabilitiesQuery: {
        data: createMembershipCapabilities(),
        isError: false,
        isPending: false,
      } as never,
      invitationsQuery: {
        data: undefined,
        isError: false,
        isFetching: false,
        isPending: false,
      } as never,
      membersQuery: {
        data: undefined,
        error: new Error("boom"),
        isError: true,
        isFetching: false,
        isPending: false,
      } as never,
    });

    expect(state.isPageLoading).toBe(false);
    expect(state.loadErrorMessage).toBe("boom");
    expect(state.listErrorNoticeMessage).toBeNull();
    expect(state.members).toEqual([]);
  });
});
