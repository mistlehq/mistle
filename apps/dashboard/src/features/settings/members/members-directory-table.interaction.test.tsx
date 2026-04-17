// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";

describe("MembersDirectoryTable interaction", () => {
  function getInvitationRow(): HTMLElement {
    const invitationRow = screen.getAllByRole("row")[1];
    if (invitationRow === undefined) {
      throw new Error("Expected invitation row.");
    }

    return invitationRow;
  }

  const baseProps = {
    activeFilter: "members" as const,
    capabilities: null,
    canManageInvitations: true,
    memberAvatarsByUserId: new Map(),
    onChangeRole: () => {},
    onRemoveMember: () => {},
    onResendInvite: () => {},
    onRevokeInvite: () => {},
    onSearchValueChange: () => {},
    pendingMemberOperation: null,
    invitationActionState: null,
    searchValue: "",
  } as const;

  function renderTable(element: React.JSX.Element): ReturnType<typeof render> {
    return render(element);
  }

  it("renders the shared search input on the active tab", () => {
    renderTable(<MembersDirectoryTable {...baseProps} invitations={[]} members={[]} />);

    expect(screen.getByLabelText("Search")).toBeTruthy();
  });

  it("renders an invitations-specific search input on the invited tab", () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        activeFilter="invitations"
        invitations={[]}
        members={[]}
      />,
    );

    expect(screen.getByLabelText("Search")).toBeTruthy();
  });

  it("opens member actions menu and shows row actions", async () => {
    renderTable(
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

    fireEvent.click(screen.getByLabelText("Member actions"));

    expect(await screen.findByText("Change role")).toBeTruthy();
    expect(await screen.findByText("Remove member")).toBeTruthy();
  });

  it("opens invitation actions menu and shows invitation actions", async () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Invitation actions"));

    expect(await screen.findByText("Resend invite")).toBeTruthy();
    expect(await screen.findByText("Cancel invitation")).toBeTruthy();
  });

  it("shows invited by and expiry details directly in the invitations table", () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        activeFilter="invitations"
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
      />,
    );

    const invitationRow = getInvitationRow();
    const expiryTime = invitationRow.querySelector("time");
    if (expiryTime === null) {
      throw new Error("Expected invitation expiry time element.");
    }

    expect(within(invitationRow).getByText("Inviter Name")).toBeTruthy();
    expect(expiryTime.getAttribute("dateTime")).toBe("2099-01-02T00:00:00.000Z");
  });

  it("shows sending state in place of invitation actions while resend is pending", () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
        invitationActionState={{
          invitationId: "inv_1",
          action: "resend_invite",
          phase: "pending",
        }}
      />,
    );

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "resend_invite_pending",
    );
  });

  it("shows sent state then allows returning to invitation actions", () => {
    const { rerender } = render(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
        invitationActionState={{
          invitationId: "inv_1",
          action: "resend_invite",
          phase: "completed",
        }}
      />,
    );

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "resend_invite_completed",
    );

    rerender(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
        invitationActionState={null}
      />,
    );

    expect(screen.getByLabelText("Invitation actions")).toBeTruthy();
  });

  it("shows canceled state in place of invitation actions", () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            inviterName: "Inviter Name",
            status: "pending",
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
        invitationActionState={{
          invitationId: "inv_1",
          action: "revoke_invitation",
          phase: "completed",
        }}
      />,
    );

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "revoke_invitation_completed",
    );
  });

  it("shows filtered empty state when the current page has no rows for the active query", () => {
    renderTable(
      <MembersDirectoryTable
        {...baseProps}
        activeFilter="members"
        invitations={[]}
        members={[]}
        searchValue="no-match-value"
      />,
    );

    expect(screen.getByText("No rows match the current search.")).toBeTruthy();
  });
});
