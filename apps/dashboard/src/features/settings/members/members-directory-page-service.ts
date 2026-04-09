import { getControlPlaneApiClient } from "../../../lib/control-plane-api/client.js";
import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { MembersApiError } from "./members-api-errors.js";
import type { MembersDirectoryFilter, MembersDirectoryPage } from "./members-api-types.js";
import { parseMembersDirectoryPage } from "./members-directory-page-parser.js";

export async function listMembersDirectoryPage(input: {
  organizationId: string;
  limit: number;
  offset: number;
  filter: MembersDirectoryFilter;
  search: string;
}): Promise<MembersDirectoryPage> {
  try {
    const client = getControlPlaneApiClient();
    const { data } = await client.GET("/v1/organizations/{organizationId}/directory", {
      credentials: "include",
      params: {
        path: {
          organizationId: input.organizationId,
        },
        query: {
          limit: input.limit,
          offset: input.offset,
          filter: input.filter,
          search: input.search,
        },
      },
    });

    return parseMembersDirectoryPage(data);
  } catch (error) {
    throw new MembersApiError(
      normalizeHttpApiError({
        operation: "listMembersDirectoryPage",
        error,
        fallbackMessage: "Failed to load members.",
      }),
    );
  }
}
