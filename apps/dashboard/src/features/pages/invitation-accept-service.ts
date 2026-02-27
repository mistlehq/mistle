import { getDashboardConfig } from "../../config.js";
import { requestControlPlane } from "../api/request-control-plane.js";
import type { InvitationDetails } from "./invitation-accept-state.js";
import { parseInvitationDetails } from "./invitation-accept-state.js";

type AuthApiRequestMethod = "GET" | "POST";

const dashboardConfig = getDashboardConfig();

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

export async function fetchAuthApi(input: {
  path: string;
  method: AuthApiRequestMethod;
  query?: Record<string, string>;
  body?: Record<string, string>;
}): Promise<unknown> {
  const response = await requestControlPlane({
    operation: `authApi:${input.path}`,
    pathname: input.path,
    basePath: dashboardConfig.authBasePath,
    method: input.method,
    body: input.body,
    fallbackMessage: "Authentication request failed.",
    ...(input.query === undefined ? {} : { query: input.query }),
  });

  return readResponsePayload(response);
}

export async function fetchInvitation(invitationId: string): Promise<InvitationDetails> {
  const response = await fetchAuthApi({
    path: "/organization/get-invitation",
    method: "GET",
    query: { id: invitationId },
  });
  const parsed = parseInvitationDetails(response);
  if (parsed === null) {
    throw new Error("Invalid invitation payload.");
  }
  return parsed;
}

export async function acceptInvitationAndSetActiveOrganization(input: {
  invitationId: string;
  organizationId: string;
}): Promise<void> {
  await fetchAuthApi({
    path: "/organization/accept-invitation",
    method: "POST",
    body: { invitationId: input.invitationId },
  });

  await fetchAuthApi({
    path: "/organization/set-active",
    method: "POST",
    body: { organizationId: input.organizationId },
  });
}

export async function rejectInvitation(input: { invitationId: string }): Promise<void> {
  await fetchAuthApi({
    path: "/organization/reject-invitation",
    method: "POST",
    body: { invitationId: input.invitationId },
  });
}
