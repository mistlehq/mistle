import { describe, expect, it } from "vitest";

import {
  buildInvitationActionDescriptors,
  buildMemberActionDescriptors,
  buildMembersDirectoryRows,
  canResendInvitation,
  filterMembersDirectoryRows,
  formatMembersDirectoryRow,
  isInvitationActionDisabled,
  resolveInvitationActionFeedback,
  resolveInvitationDisplayStatus,
} from "./members-directory-model.js";
describe("members directory model", () => {
  it("maps pending invitation past expiry to expired", () => {
    const status = resolveInvitationDisplayStatus({
      id: "invite_1",
      organizationId: "org_1",
      email: "person@example.com",
      role: "member",
      inviterId: "user_1",
      status: "pending",
      rawStatus: null,
      expiresAt: "1970-01-02T00:00:00.000Z",
      createdAt: "2026-02-20T12:00:00.000Z",
    });

    expect(status).toEqual({ kind: "expired" });
  });

  it("allows resend for pending and expired invitations", () => {
    expect(canResendInvitation({ kind: "pending" })).toBe(true);
    expect(canResendInvitation({ kind: "expired" })).toBe(true);
    expect(canResendInvitation({ kind: "accepted" })).toBe(false);
  });

  it("disables invitation actions when invite is already processing", () => {
    expect(
      isInvitationActionDisabled({
        canManageInvitations: true,
        invitationId: "invite_1",
        invitationActionState: {
          invitationId: "invite_1",
          action: "resend_invite",
          phase: "pending",
        },
      }),
    ).toBe(true);
    expect(
      isInvitationActionDisabled({
        canManageInvitations: true,
        invitationId: "invite_1",
        invitationActionState: {
          invitationId: "invite_1",
          action: "revoke_invitation",
          phase: "pending",
        },
      }),
    ).toBe(true);
    expect(
      isInvitationActionDisabled({
        canManageInvitations: false,
        invitationId: "invite_1",
        invitationActionState: null,
      }),
    ).toBe(true);
    expect(
      isInvitationActionDisabled({
        canManageInvitations: true,
        invitationId: "invite_1",
        invitationActionState: null,
      }),
    ).toBe(false);
  });

  it("builds unified rows for members and invitations", () => {
    const rows = buildMembersDirectoryRows({
      members: [
        {
          id: "mem_1",
          userId: "user_1",
          name: "  ",
          email: "member1@example.com",
          role: "member",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      invitations: [
        {
          id: "invite_1",
          organizationId: "org_1",
          email: "invitee@example.com",
          role: "admin",
          inviterId: "user_1",
          status: "pending",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "invitation",
      name: "invitee@example.com",
      email: "invitee@example.com",
      status: "Admin (Invited)",
      displayStatus: { kind: "pending" },
    });
    expect(rows[1]).toMatchObject({
      kind: "member",
      name: "member1@example.com",
      email: "member1@example.com",
      status: "Member",
    });
  });

  it("sorts rows deterministically", () => {
    const rows = buildMembersDirectoryRows({
      members: [
        {
          id: "mem_2",
          userId: "user_2",
          name: "zoe",
          email: "zoe@example.com",
          role: "member",
          joinedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "mem_1",
          userId: "user_1",
          name: "Ada",
          email: "ada@example.com",
          role: "admin",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      invitations: [
        {
          id: "invite_1",
          organizationId: "org_1",
          email: "older@example.com",
          role: "member",
          inviterId: "user_1",
          status: "pending",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "invite_2",
          organizationId: "org_1",
          email: "newer@example.com",
          role: "member",
          inviterId: "user_1",
          status: "pending",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["invite_2", "mem_2", "mem_1", "invite_1"]);
  });

  it("filters rows by table mode and search query", () => {
    const rows = buildMembersDirectoryRows({
      members: [
        {
          id: "mem_1",
          userId: "user_1",
          name: "Ada",
          email: "ada@example.com",
          role: "admin",
          joinedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      invitations: [
        {
          id: "invite_1",
          organizationId: "org_1",
          email: "pending@example.com",
          role: "member",
          inviterId: "user_1",
          status: "pending",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "invite_2",
          organizationId: "org_1",
          email: "accepted@example.com",
          role: "member",
          inviterId: "user_1",
          status: "accepted",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });

    expect(
      filterMembersDirectoryRows({
        rows,
        filter: "members",
        search: "",
      }).map((row) => row.id),
    ).toEqual(["mem_1"]);

    expect(
      filterMembersDirectoryRows({
        rows,
        filter: "all",
        search: "accepted@example.com",
      }).map((row) => row.id),
    ).toEqual(["invite_2"]);
  });

  it("formats a unified table row payload", () => {
    const rows = buildMembersDirectoryRows({
      members: [],
      invitations: [
        {
          id: "invite_1",
          organizationId: "org_1",
          email: "invitee@example.com",
          role: "member",
          inviterId: "user_1",
          status: "pending",
          rawStatus: null,
          expiresAt: "3026-01-01T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    const [firstRow] = rows;
    if (firstRow === undefined) {
      throw new Error("Expected at least one row.");
    }

    expect(formatMembersDirectoryRow(firstRow)).toMatchObject({
      name: "invitee@example.com",
      email: "invitee@example.com",
      status: "Member (Invited)",
    });
  });

  it("builds member actions with pending labels", () => {
    const actions = buildMemberActionDescriptors({
      member: {
        id: "mem_1",
        userId: "user_1",
        name: "Member",
        email: "member@example.com",
        role: "member",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
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
      pendingMemberOperation: {
        kind: "remove_member",
        memberId: "mem_1",
      },
    });

    expect(actions).toEqual([
      {
        key: "change_role",
        label: "Change role",
        disabled: true,
        destructive: false,
      },
      {
        key: "remove_member",
        label: "Removing member...",
        disabled: true,
        destructive: true,
      },
    ]);
  });

  it("builds invitation actions with pending labels", () => {
    const actions = buildInvitationActionDescriptors({
      displayStatus: { kind: "expired" },
      canManageInvitations: true,
      invitationId: "invite_1",
      invitationActionState: {
        invitationId: "invite_1",
        action: "resend_invite",
        phase: "pending",
      },
    });

    expect(actions).toEqual([
      {
        key: "view_details",
        label: "View details",
        disabled: false,
        destructive: false,
      },
      {
        key: "resend_invite",
        label: "Resending invite...",
        disabled: true,
        destructive: false,
      },
      {
        key: "revoke_invitation",
        label: "Revoke invitation",
        disabled: true,
        destructive: true,
      },
    ]);
  });

  it("resolves invitation row feedback for pending and completed actions", () => {
    expect(
      resolveInvitationActionFeedback({
        invitationId: "invite_1",
        invitationActionState: {
          invitationId: "invite_1",
          action: "resend_invite",
          phase: "pending",
        },
      }),
    ).toEqual({
      label: "Sending...",
      tone: "pending",
    });

    expect(
      resolveInvitationActionFeedback({
        invitationId: "invite_1",
        invitationActionState: {
          invitationId: "invite_1",
          action: "resend_invite",
          phase: "completed",
        },
      }),
    ).toEqual({
      label: "Sent",
      tone: "success",
    });

    expect(
      resolveInvitationActionFeedback({
        invitationId: "invite_1",
        invitationActionState: {
          invitationId: "invite_1",
          action: "revoke_invitation",
          phase: "completed",
        },
      }),
    ).toEqual({
      label: "Revoked",
      tone: "destructive",
    });
  });
});
