import { executeMembersOperation } from "./members-api-errors.js";
import type {
  InviteMemberResponse,
  OrganizationRole,
  SettingsInvitation,
} from "./members-api-types.js";
import {
  parseInviteMemberResponse,
  parseInvitationsResponse,
} from "./members-invitations-parser.js";

type MembersInvitationsQuery = Record<string, string>;
type MembersInvitationsBody = Record<string, string | boolean>;

export type MembersInvitationsFetchClient = {
  $fetch: (
    path: string,
    options: {
      method: "GET" | "POST";
      throw: boolean;
      query?: MembersInvitationsQuery;
      body?: MembersInvitationsBody;
    },
  ) => Promise<unknown>;
};

export function createMembersInvitationsService(client: MembersInvitationsFetchClient): {
  listInvitations: (input: { organizationId: string }) => Promise<SettingsInvitation[]>;
  inviteMember: (input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    resend?: boolean;
  }) => Promise<InviteMemberResponse>;
  revokeInvitation: (input: { invitationId: string }) => Promise<void>;
} {
  return {
    async listInvitations(input: { organizationId: string }): Promise<SettingsInvitation[]> {
      return executeMembersOperation("listInvitations", async () => {
        const result = await client.$fetch("/organization/list-invitations", {
          method: "GET",
          throw: true,
          query: {
            organizationId: input.organizationId,
          },
        });
        const parsed = parseInvitationsResponse(result);
        return parsed;
      });
    },
    async inviteMember(input: {
      organizationId: string;
      email: string;
      role: OrganizationRole;
      resend?: boolean;
    }): Promise<InviteMemberResponse> {
      return executeMembersOperation("inviteMember", async () => {
        const response = await client.$fetch("/organization/invite-member", {
          method: "POST",
          throw: true,
          body: {
            organizationId: input.organizationId,
            email: input.email,
            role: input.role,
            ...(input.resend === undefined
              ? {}
              : {
                  resend: input.resend,
                }),
          },
        });
        return parseInviteMemberResponse(response);
      });
    },
    async revokeInvitation(input: { invitationId: string }): Promise<void> {
      return executeMembersOperation("revokeInvitation", async () => {
        await client.$fetch("/organization/cancel-invitation", {
          method: "POST",
          throw: true,
          body: {
            invitationId: input.invitationId,
          },
        });
      });
    },
  };
}
