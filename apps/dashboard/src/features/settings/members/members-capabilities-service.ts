import type { MembershipCapabilities } from "./members-api-types.js";

import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "./members-api-errors.js";

export async function getMembershipCapabilities(input: {
  organizationId: string;
}): Promise<MembershipCapabilities> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET(
      "/v1/organizations/{organizationId}/membership-capabilities",
      {
        credentials: "include",
        params: {
          path: {
            organizationId: input.organizationId,
          },
        },
      },
    );

    if (data === undefined || data.ok !== true || data.data === null) {
      throw new MembersApiError({
        operation: "getMembershipCapabilities",
        status: 500,
        body: data ?? null,
        message: "Membership capabilities response was invalid.",
        code: null,
      });
    }

    const roleTransitionMatrix = data.data.memberRoleUpdate.roleTransitionMatrix;
    if (
      roleTransitionMatrix.owner === undefined ||
      roleTransitionMatrix.admin === undefined ||
      roleTransitionMatrix.member === undefined
    ) {
      throw new MembersApiError({
        operation: "getMembershipCapabilities",
        status: 500,
        body: data,
        message: "Membership capabilities payload was invalid.",
        code: null,
      });
    }

    return {
      ...data.data,
      memberRoleUpdate: {
        ...data.data.memberRoleUpdate,
        roleTransitionMatrix: {
          owner: roleTransitionMatrix.owner,
          admin: roleTransitionMatrix.admin,
          member: roleTransitionMatrix.member,
        },
      },
    };
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "getMembershipCapabilities",
        error,
        fallbackMessage: "Failed to load membership capabilities.",
      }),
    );
  }
}
