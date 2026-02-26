import type { OrganizationRole, SettingsMember } from "./members-api-types.js";

import { authClient } from "../../../lib/auth/client.js";
import { executeMembersOperation } from "./members-api-errors.js";
import { parseMembersPageResponse } from "./members-directory-parser.js";

export async function listMembers(input: { organizationId: string }): Promise<SettingsMember[]> {
  return executeMembersOperation("listMembers", async () => {
    const limit = 100;
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    const members: SettingsMember[] = [];

    while (offset < total) {
      const page = await authClient.$fetch("/organization/list-members", {
        method: "GET",
        throw: true,
        query: {
          organizationId: input.organizationId,
          limit,
          offset,
        },
      });
      const parsedPage = parseMembersPageResponse(page);
      members.push(...parsedPage.members);
      total = parsedPage.total;

      if (parsedPage.rawCount === 0) {
        break;
      }

      offset += parsedPage.rawCount;
    }

    return members;
  });
}

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
