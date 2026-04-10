// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { DEFAULT_SEARCH_DEBOUNCE_MS } from "../../shared/use-debounced-value.js";
import type {
  InvitationsPage,
  MembershipCapabilities,
  MembersPage,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import type { MembersSettingsApi } from "./members-settings-api.js";
import { useOrganizationMembersSettingsState } from "./use-organization-members-settings-state.js";

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

function createMember(index: number, name = `Member ${index}`): SettingsMember {
  return {
    id: `mem_${index}`,
    userId: `user_${index}`,
    name,
    email: `member${index}@example.com`,
    role: "member",
    joinedAt: "2026-03-01T00:00:00.000Z",
  };
}

function createInvitation(email: string): SettingsInvitation {
  return {
    id: `inv_${email}`,
    organizationId: "org_123",
    email,
    role: "member",
    inviterId: "user_admin",
    inviterName: "Admin User",
    status: "pending",
    expiresAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
  };
}

function createMembersPage(input: {
  members: SettingsMember[];
  offset: number;
  total: number;
}): MembersPage {
  return {
    members: input.members,
    memberAvatarsByUserId: new Map(),
    limit: 25,
    offset: input.offset,
    total: input.total,
  };
}

function createMembersSettingsApi(): MembersSettingsApi {
  return {
    getMembershipCapabilities: async () => createMembershipCapabilities(),
    listMembersPage: async (input) => {
      if (input.search === "al") {
        return createMembersPage({
          members: [createMember(100, "Alpha Result")],
          offset: input.offset,
          total: 1,
        });
      }

      return createMembersPage({
        members: Array.from({ length: 25 }, (_, index) => createMember(input.offset + index)),
        offset: input.offset,
        total: 60,
      });
    },
    listInvitationsPage: async (input): Promise<InvitationsPage> => {
      if (input.search === "ga") {
        return {
          invitations: [createInvitation("gamma@example.com")],
          limit: 25,
          offset: input.offset,
          total: 1,
        };
      }

      return {
        invitations: [createInvitation("default@example.com")],
        limit: 25,
        offset: input.offset,
        total: 1,
      };
    },
    inviteMember: async () => ({
      status: null,
      message: null,
      code: null,
      raw: null,
    }),
    revokeInvitation: async () => undefined,
    updateMemberRole: async () => undefined,
    removeMember: async () => undefined,
  };
}

function createWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useOrganizationMembersSettingsState", () => {
  it("keeps pagination aligned with the committed query until a debounced search is applied", async () => {
    const { result } = renderHook(
      () =>
        useOrganizationMembersSettingsState({
          organizationId: "org_123",
          api: createMembersSettingsApi(),
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.viewModel.members[0]?.name).toBe("Member 0");
    });

    act(() => {
      result.current.viewModel.onNextPage();
    });

    await waitFor(() => {
      expect(result.current.viewModel.offset).toBe(25);
      expect(result.current.viewModel.members[0]?.name).toBe("Member 25");
      expect(result.current.viewModel.hasPreviousPage).toBe(true);
      expect(result.current.viewModel.hasNextPage).toBe(true);
    });

    act(() => {
      result.current.viewModel.onSearchValueChange("al");
    });

    expect(result.current.viewModel.searchValue).toBe("al");
    expect(result.current.viewModel.offset).toBe(25);
    expect(result.current.viewModel.members[0]?.name).toBe("Member 25");
    expect(result.current.viewModel.hasPreviousPage).toBe(true);
    expect(result.current.viewModel.hasNextPage).toBe(true);

    await waitFor(
      () => {
        expect(result.current.viewModel.offset).toBe(0);
        expect(result.current.viewModel.members[0]?.name).toBe("Alpha Result");
        expect(result.current.viewModel.hasPreviousPage).toBe(false);
        expect(result.current.viewModel.hasNextPage).toBe(false);
      },
      {
        timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 300,
      },
    );
  });

  it("uses the current search input immediately when switching tabs during a pending debounce", async () => {
    const { result } = renderHook(
      () =>
        useOrganizationMembersSettingsState({
          organizationId: "org_123",
          api: createMembersSettingsApi(),
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.viewModel.members[0]?.name).toBe("Member 0");
    });

    act(() => {
      result.current.viewModel.onSearchValueChange("ga");
      result.current.viewModel.onFilterChange("invitations");
    });

    expect(result.current.viewModel.activeFilter).toBe("invitations");
    expect(result.current.viewModel.searchValue).toBe("ga");
    expect(result.current.viewModel.offset).toBe(0);

    await waitFor(
      () => {
        expect(result.current.viewModel.invitations[0]?.email).toBe("gamma@example.com");
      },
      {
        timeout: Math.max(DEFAULT_SEARCH_DEBOUNCE_MS - 100, 1),
      },
    );
  });
});
