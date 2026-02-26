// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";

describe("MembersDirectoryTable interaction", () => {
  afterEach(() => {
    cleanup();
  });

  const baseProps = {
    capabilities: null,
    canManageInvitations: true,
    onChangeRole: () => {},
    onRemoveMember: () => {},
    onResendInvite: () => {},
    onRevokeInvite: () => {},
    resolveInviterDisplayName: (inviterId: string) => inviterId,
    pendingMemberOperation: null,
    invitationActionState: null,
  } as const;

  it("shows capitalized filter label in trigger", () => {
    render(<MembersDirectoryTable {...baseProps} invitations={[]} members={[]} />);

    const filterTrigger = screen.getByLabelText("Filter directory rows");
    expect(filterTrigger.textContent).toContain("All");
    expect(filterTrigger.textContent).not.toContain("all");
  });

  it("opens member actions menu and shows row actions", async () => {
    render(
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

    fireEvent.click(screen.getByLabelText("Member actions"));

    expect(await screen.findByText("Change role")).toBeTruthy();
    expect(await screen.findByText("Remove member")).toBeTruthy();
  });

  it("opens invitation actions menu and shows invitation actions", async () => {
    render(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            status: "pending",
            rawStatus: null,
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Invitation actions"));

    expect(await screen.findByText("View details")).toBeTruthy();
    expect(await screen.findByText("Resend invite")).toBeTruthy();
    expect(await screen.findByText("Revoke invitation")).toBeTruthy();
  });

  it("shows sending state in place of invitation actions while resend is pending", () => {
    render(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            status: "pending",
            rawStatus: null,
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

    expect(screen.queryByLabelText("Invitation actions")).toBeNull();
    expect(screen.getByText("Sending...")).toBeTruthy();
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
            status: "pending",
            rawStatus: null,
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

    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.queryByLabelText("Invitation actions")).toBeNull();

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
            status: "pending",
            rawStatus: null,
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

  it("shows revoked state in place of invitation actions", () => {
    render(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            status: "pending",
            rawStatus: null,
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

    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.queryByLabelText("Invitation actions")).toBeNull();
  });

  it("shows filtered empty state when rows exist but no row matches", () => {
    render(
      <MembersDirectoryTable
        {...baseProps}
        invitations={[
          {
            id: "inv_1",
            organizationId: "org_1",
            email: "invitee@example.com",
            role: "member",
            inviterId: "user_1",
            status: "pending",
            rawStatus: null,
            createdAt: "2099-01-01T00:00:00.000Z",
            expiresAt: "2099-01-02T00:00:00.000Z",
          },
        ]}
        members={[
          {
            id: "mem_1",
            userId: "user_1",
            name: "Ada",
            email: "ada@example.com",
            role: "member",
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search members and invitations"), {
      target: { value: "no-match-value" },
    });

    expect(screen.getByText("No rows match the current search or filter.")).toBeTruthy();
  });
});
