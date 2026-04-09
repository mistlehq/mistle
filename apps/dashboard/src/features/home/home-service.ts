import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";

export const HomeSummaryResponseSchema = z
  .object({
    onboarding: z
      .object({
        hasIntegrations: z.boolean(),
        hasProfiles: z.boolean(),
        hasUsableProfiles: z.boolean(),
        hasStartedSession: z.boolean(),
        hasWebhookCapableIntegration: z.boolean(),
        hasAutomations: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type HomeSummaryResponse = z.infer<typeof HomeSummaryResponseSchema>;

export async function getHomeSummary(input?: {
  signal?: AbortSignal;
}): Promise<HomeSummaryResponse> {
  const response = await requestControlPlane({
    operation: "getHomeSummary",
    method: "GET",
    pathname: "/v1/home",
    ...(input?.signal === undefined ? {} : { signal: input.signal }),
    fallbackMessage: "Could not load home summary.",
  });

  const responseBody = await response.json().catch((): unknown => null);
  const parsedResponse = HomeSummaryResponseSchema.safeParse(responseBody);
  if (!parsedResponse.success) {
    throw new Error("Home summary response payload is invalid.");
  }

  return parsedResponse.data;
}
