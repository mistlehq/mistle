import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";
import { buildMembersQueryKeys } from "./members-query-keys.js";

function renderMembersDirectoryTable(element: React.JSX.Element): string {
  const queryClient = new QueryClient();
  seedMemberAvatarsQueryCache({
    queryClient,
    element,
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

function seedMemberAvatarsQueryCache(input: {
  queryClient: QueryClient;
  element: React.JSX.Element;
}): void {
  const props = input.element.props as {
    organizationId?: string;
    members?: Array<{ userId: string }>;
  };
  if (typeof props.organizationId !== "string" || !Array.isArray(props.members)) {
    return;
  }

  const userIds = props.members.map((member) => member.userId);
  input.queryClient.setQueryData(
    [...buildMembersQueryKeys(props.organizationId).memberAvatars, ...userIds],
    [],
  );
}

describe("MembersDirectoryTable", () => {
  it("uses a scrollable table with explicit column wrapping choices", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        capabilities={null}
        canManageInvitations
        invitations={[]}
        members={[]}
        organizationId="org_1"
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        resolveInviterDisplayName={(inviterId) => inviterId}
        pendingMemberOperation={null}
        invitationActionState={null}
      />,
    );

    expect(markup).toContain('data-slot="table-container" class="relative w-full overflow-x-auto"');
    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[48rem]"',
    );
    expect(markup).not.toContain("<colgroup>");
  });

  it("hides role and removal actions when capabilities are unavailable", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        capabilities={null}
        canManageInvitations
        invitations={[]}
        members={[
          {
            id: "mem_1",
            userId: "user_1",
            name: "Member One",
            email: "member1@example.com",
            role: "member",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        organizationId="org_1"
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        resolveInviterDisplayName={(inviterId) => inviterId}
        pendingMemberOperation={null}
        invitationActionState={null}
      />,
    );

    expect(markup).not.toContain("Member actions");
  });

  it("shows a member action menu for each member row when actions are available", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        capabilities={{
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
        }}
        canManageInvitations
        invitations={[]}
        members={[
          {
            id: "mem_1",
            userId: "user_1",
            name: "Owner",
            email: "owner@example.com",
            role: "owner",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "mem_2",
            userId: "user_2",
            name: "Member",
            email: "member@example.com",
            role: "member",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        organizationId="org_1"
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        resolveInviterDisplayName={(inviterId) => inviterId}
        pendingMemberOperation={null}
        invitationActionState={null}
      />,
    );

    const actionMenuCount = (markup.match(/Member actions/g) ?? []).length;

    expect(actionMenuCount).toBe(2);
  });

  it("renders member avatar fallback markup in the name column", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        capabilities={null}
        canManageInvitations
        invitations={[]}
        members={[
          {
            id: "mem_1",
            userId: "user_1",
            name: "Member One",
            email: "member1@example.com",
            role: "member",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        organizationId="org_1"
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        resolveInviterDisplayName={(inviterId) => inviterId}
        pendingMemberOperation={null}
        invitationActionState={null}
      />,
    );

    expect(markup).toContain("MO");
  });
});
