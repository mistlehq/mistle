import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";

describe("MembersDirectoryTable", () => {
  it("hides role and removal actions when capabilities are unavailable", () => {
    const markup = renderToStaticMarkup(
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
    const markup = renderToStaticMarkup(
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
});
