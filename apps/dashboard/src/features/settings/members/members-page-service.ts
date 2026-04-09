import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "./members-api-errors.js";
import type { MembersPage } from "./members-api-types.js";
import { parseMembersPage } from "./members-page-parser.js";

export async function listMembersPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  search: string;
}): Promise<MembersPage> {
  try {
    const client = getControlPlaneApiClient();
    const response = await client.GET("/v1/organizations/{organizationId}/members", {
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

    return parseMembersPage(response.data);
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "listMembersPage",
        error,
        fallbackMessage: "Failed to load members.",
      }),
    );
  }
}
