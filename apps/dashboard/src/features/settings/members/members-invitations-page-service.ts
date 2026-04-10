import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "./members-api-errors.js";
import type { InvitationsPage } from "./members-api-types.js";
import { parseInvitationsPage } from "./members-invitations-page-parser.js";

export async function listInvitationsPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
}): Promise<InvitationsPage> {
  try {
    const client = getControlPlaneApiClient();
    const response = await client.GET("/v1/organizations/{organizationId}/invitations", {
      credentials: "include",
      params: {
        path: {
          organizationId: input.organizationId,
        },
        query: {
          limit: input.limit,
          offset: input.offset,
          search: input.search,
        },
      },
    });
    if (response.error !== undefined) {
      throw response.error;
    }

    return parseInvitationsPage(response.data);
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "listInvitationsPage",
        error,
        fallbackMessage: "Failed to load invitations.",
      }),
    );
  }
}
