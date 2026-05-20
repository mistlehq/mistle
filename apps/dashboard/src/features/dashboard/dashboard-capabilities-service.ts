import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";

const DashboardReleaseVersionHeaderName = "x-mistle-release-version";

export const DashboardCapabilitiesResponseSchema = z
  .object({
    billing: z
      .object({
        stripe: z
          .object({
            enabled: z.literal(true),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type DashboardCapabilitiesResponse = z.infer<typeof DashboardCapabilitiesResponseSchema>;

function readDashboardCapabilitiesReleaseVersion(response: Response): string | null {
  return response.headers.get(DashboardReleaseVersionHeaderName);
}

async function requestDashboardCapabilities(input?: { signal?: AbortSignal }): Promise<Response> {
  return requestControlPlane({
    operation: "getDashboardCapabilities",
    method: "GET",
    pathname: "/v1/dashboard/capabilities",
    ...(input?.signal === undefined ? {} : { signal: input.signal }),
    fallbackMessage: "Could not load dashboard capabilities.",
  });
}

export async function getDashboardCapabilities(input?: {
  signal?: AbortSignal;
}): Promise<DashboardCapabilitiesResponse> {
  const response = await requestDashboardCapabilities(input);

  const responseBody = await response.json().catch((): unknown => null);
  const parsedResponse = DashboardCapabilitiesResponseSchema.safeParse(responseBody);
  if (!parsedResponse.success) {
    throw new Error("Dashboard capabilities response payload is invalid.");
  }

  return parsedResponse.data;
}

export async function getDashboardCapabilitiesReleaseVersion(input?: {
  signal?: AbortSignal;
}): Promise<string | null> {
  const response = await requestDashboardCapabilities(input);

  return readDashboardCapabilitiesReleaseVersion(response);
}
