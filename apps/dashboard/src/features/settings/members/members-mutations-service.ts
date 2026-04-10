import { authClient } from "../../../lib/auth/client.js";
import { executeMembersOperation } from "./members-api-errors.js";
import type { OrganizationRole } from "./members-api-types.js";

export async function updateMemberRole(input: {
  organizationId: string;
  memberId: string;
  role: OrganizationRole;
}): Promise<void> {
  return executeMembersOperation("updateMemberRole", async () => {
    await authClient.$fetch("/organization/update-member-role", {
      method: "POST",
      throw: true,
      body: {
        organizationId: input.organizationId,
        memberId: input.memberId,
        role: input.role,
      },
    });
  });
}

export async function removeMember(input: {
  organizationId: string;
  memberIdOrEmail: string;
}): Promise<void> {
  return executeMembersOperation("removeMember", async () => {
    await authClient.$fetch("/organization/remove-member", {
      method: "POST",
      throw: true,
      body: {
        organizationId: input.organizationId,
        memberIdOrEmail: input.memberIdOrEmail,
      },
    });
  });
}
