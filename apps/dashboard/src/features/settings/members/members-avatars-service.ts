import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "./members-api-errors.js";
import type { MemberAvatar } from "./members-api-types.js";

export async function listMemberAvatars(input: {
  organizationId: string;
  userIds: readonly string[];
}): Promise<MemberAvatar[]> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.POST("/v1/organizations/{organizationId}/member-avatars", {
      credentials: "include",
      params: {
        path: {
          organizationId: input.organizationId,
        },
      },
      body: {
        userIds: [...input.userIds],
      },
    });

    if (data === undefined) {
      throw new MembersApiError({
        operation: "listMemberAvatars",
        status: 500,
        body: null,
        message: "Member avatars response was invalid.",
        code: null,
      });
    }

    return data;
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "listMemberAvatars",
        error,
        fallbackMessage: "Failed to load member avatars.",
      }),
    );
  }
}
