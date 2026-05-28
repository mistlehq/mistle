import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";

const HomeSandboxInstanceListItemSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileDisplayName: z.string().min(1).nullable(),
    sandboxProfileVersion: z.number().int().min(1),
    title: z.string().min(1).nullable(),
    status: z.enum([
      SandboxInstanceStatuses.PENDING,
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
      SandboxInstanceStatuses.RECONNECTING,
      SandboxInstanceStatuses.STOPPING,
      SandboxInstanceStatuses.STOPPED,
      SandboxInstanceStatuses.FAILED,
    ]),
    startedBy: z
      .object({
        kind: z.enum(["user", "system"]),
        id: z.string().min(1),
        name: z.string().min(1).nullable(),
      })
      .strict(),
    source: z.enum(["dashboard", "webhook", "schedule"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
  })
  .strict();

export const HomeSummaryResponseSchema = z
  .object({
    onboarding: z
      .object({
        hasIntegrations: z.boolean(),
        hasProfiles: z.boolean(),
        hasUsableProfiles: z.boolean(),
        hasStartedSession: z.boolean(),
        hasWebhookCapableIntegration: z.boolean(),
        hasTriggers: z.boolean(),
      })
      .strict(),
    recentSessions: z.array(HomeSandboxInstanceListItemSchema),
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
