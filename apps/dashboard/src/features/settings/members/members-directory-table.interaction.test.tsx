// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MembersDirectoryTable } from "./members-directory-table.js";
import { buildMembersQueryKeys } from "./members-query-keys.js";

describe("MembersDirectoryTable interaction", () => {
  afterEach(() => {
    cleanup();
  });

  function getInvitationRow(): HTMLElement {
    const invitationRow = screen.getAllByRole("row")[1];
    if (invitationRow === undefined) {
      throw new Error("Expected invitation row.");
    }

    return invitationRow;
  }

  const baseProps = {
    capabilities: null,
    canManageInvitations: true,
    organizationId: "org_1",
    onChangeRole: () => {},
    onRemoveMember: () => {},
    onResendInvite: () => {},
    onRevokeInvite: () => {},
    resolveInviterDisplayName: (inviterId: string) => inviterId,
    pendingMemberOperation: null,
    invitationActionState: null,
  } as const;

  function renderTable(element: React.JSX.Element): ReturnType<typeof render> {
    const queryClient = new QueryClient();
    seedMemberAvatarsQueryCache({
      queryClient,
      element,
    });

    return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
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

  it("shows capitalized filter label in trigger", () => {
    renderTable(<MembersDirectoryTable {...baseProps} invitations={[]} members={[]} />);

    const filterTrigger = screen.getByLabelText("Filter directory rows");
    expect(filterTrigger.textContent).toContain("All");
    expect(filterTrigger.textContent).not.toContain("all");
  });

  it("opens member actions menu and shows row actions", async () => {
    renderTable(
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

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "resend_invite_pending",
    );
  });

  it("shows sent state then allows returning to invitation actions", () => {
    const client = new QueryClient();
    client.setQueryData([...buildMembersQueryKeys("org_1").memberAvatars], []);
    const { rerender } = render(
      <QueryClientProvider client={client}>
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
        />
      </QueryClientProvider>,
    );

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "resend_invite_completed",
    );

    rerender(
      <QueryClientProvider client={client}>
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
        />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Invitation actions")).toBeTruthy();
  });

  it("shows revoked state in place of invitation actions", () => {
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

    const invitationRow = getInvitationRow();
    expect(within(invitationRow).queryByLabelText("Invitation actions")).toBeNull();
    expect(within(invitationRow).getByRole("status").getAttribute("data-feedback-state")).toBe(
      "revoke_invitation_completed",
    );
  });

  it("shows filtered empty state when rows exist but no row matches", () => {
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
