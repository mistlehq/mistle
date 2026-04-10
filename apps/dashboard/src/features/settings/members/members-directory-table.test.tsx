import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";

function renderMembersDirectoryTable(element: React.JSX.Element): string {
  return renderToStaticMarkup(element);
}

describe("MembersDirectoryTable", () => {
  it("uses a scrollable table with explicit column wrapping choices", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        activeFilter="members"
        capabilities={null}
        canManageInvitations
        invitations={[]}
        memberAvatarsByUserId={new Map()}
        members={[]}
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
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
        activeFilter="members"
        capabilities={null}
        canManageInvitations
        invitations={[]}
        memberAvatarsByUserId={new Map()}
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
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
        invitationActionState={null}
      />,
    );

    expect(markup).not.toContain("Member actions");
  });

  it("shows a member action menu for each member row when actions are available", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        activeFilter="members"
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
        memberAvatarsByUserId={new Map()}
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
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
        invitationActionState={null}
      />,
    );

    const actionMenuCount = (markup.match(/Member actions/g) ?? []).length;

    expect(actionMenuCount).toBe(2);
  });

  it("renders member avatar fallback markup in the name column", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        activeFilter="members"
        capabilities={null}
        canManageInvitations
        invitations={[]}
        memberAvatarsByUserId={new Map()}
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
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
        invitationActionState={null}
      />,
    );

    expect(markup).toContain("MO");
  });

  it("uses a role column header on the active members tab", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        activeFilter="members"
        capabilities={null}
        canManageInvitations
        invitations={[]}
        memberAvatarsByUserId={new Map()}
        members={[]}
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
        invitationActionState={null}
      />,
    );

    expect(markup).toContain(">Role<");
    expect(markup).not.toContain(">Status<");
  });

  it("uses invitation detail column headers on the invited tab", () => {
    const markup = renderMembersDirectoryTable(
      <MembersDirectoryTable
        activeFilter="invitations"
        capabilities={null}
        canManageInvitations
        invitations={[]}
        memberAvatarsByUserId={new Map()}
        members={[]}
        onChangeRole={() => {}}
        onRemoveMember={() => {}}
        onResendInvite={() => {}}
        onRevokeInvite={() => {}}
        onSearchValueChange={() => {}}
        pendingMemberOperation={null}
        searchValue=""
        invitationActionState={null}
      />,
    );

    expect(markup).toContain(">Role<");
    expect(markup).toContain(">Status<");
    expect(markup).toContain(">Invited by<");
    expect(markup).toContain(">Expires<");
    expect(markup).not.toContain(">Name<");
  });
});
