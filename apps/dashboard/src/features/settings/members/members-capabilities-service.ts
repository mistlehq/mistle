import type { MembershipCapabilities } from "./members-api-types.js";

import { getDashboardConfig } from "../../../config.js";
import { readErrorMessage, MembersApiError } from "./members-api-errors.js";
import { parseMembershipCapabilities } from "./members-capabilities-parser.js";
import { toRecord } from "./members-records.js";

export async function getMembershipCapabilities(input: {
  organizationId: string;
}): Promise<MembershipCapabilities> {
  const config = getDashboardConfig();
  const response = await fetch(
    `${config.controlPlaneApiOrigin}/v1/organizations/${encodeURIComponent(input.organizationId)}/membership-capabilities`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
    },
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MembersApiError({
      operation: "getMembershipCapabilities",
      status: response.status,
      body: payload,
      message: readErrorMessage(payload) ?? "Failed to load membership capabilities.",
    });
  }

  const bodyRecord = toRecord(payload);
  if (bodyRecord === null || bodyRecord["ok"] !== true) {
    throw new MembersApiError({
      operation: "getMembershipCapabilities",
      status: response.status,
      body: payload,
      message: "Membership capabilities response was invalid.",
    });
  }

  const data = parseMembershipCapabilities(bodyRecord["data"]);
  if (data === null) {
    throw new MembersApiError({
      operation: "getMembershipCapabilities",
      status: response.status,
      body: payload,
      message: "Membership capabilities payload was invalid.",
    });
  }

  return data;
}
