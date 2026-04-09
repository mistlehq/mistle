import { executeMembersOperation } from "./members-api-errors.js";
import type { InviteMemberResponse, OrganizationRole } from "./members-api-types.js";
import { parseInviteMemberResponse } from "./members-invitations-parser.js";

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
  inviteMember: (input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    resend?: boolean;
  }) => Promise<InviteMemberResponse>;
  revokeInvitation: (input: { invitationId: string }) => Promise<void>;
} {
  return {
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
