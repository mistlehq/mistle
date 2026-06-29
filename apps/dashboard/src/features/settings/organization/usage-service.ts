import { z } from "zod";

import { requestControlPlane } from "../../api/request-control-plane.js";
import { MembersApiError } from "../members/members-api-errors.js";

const OrganizationUsageResponseSchema = z
  .object({
    period: z
      .object({
        start: z.iso.datetime(),
        end: z.iso.datetime(),
      })
      .strict(),
    measurement: z
      .object({
        measuredFrom: z.iso.datetime().nullable(),
        complete: z.boolean(),
      })
      .strict(),
    summary: z
      .object({
        sandboxHours: z.number().nonnegative(),
        sandboxRuns: z.number().int().nonnegative(),
        vcpuHours: z.number().nonnegative(),
        memoryGbHours: z.number().nonnegative(),
        storageGbHours: z.number().nonnegative(),
      })
      .strict(),
    dailyUsage: z.array(
      z
        .object({
          day: z.string().min(1),
          sandboxHours: z.number().nonnegative(),
          runCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    profileBreakdown: z.array(
      z
        .object({
          sandboxProfileId: z.string().min(1),
          label: z.string().min(1),
          sandboxHours: z.number().nonnegative(),
          sandboxRuns: z.number().int().nonnegative(),
          vcpuHours: z.number().nonnegative(),
          memoryGbHours: z.number().nonnegative(),
          storageGbHours: z.number().nonnegative(),
        })
        .strict(),
    ),
    activityBreakdown: z.array(
      z
        .object({
          activity: z.enum([
            "user_sessions",
            "designer_sessions",
            "trigger_runs",
            "setup_assistants",
            "setup_script_checks",
            "snapshot_maintenance",
          ]),
          label: z.string().min(1),
          sandboxHours: z.number().nonnegative(),
          sandboxRuns: z.number().int().nonnegative(),
          vcpuHours: z.number().nonnegative(),
          memoryGbHours: z.number().nonnegative(),
          storageGbHours: z.number().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export type OrganizationUsageResponse = z.infer<typeof OrganizationUsageResponseSchema>;

export function organizationUsageQueryKey(input: {
  activeOrganizationId: string;
  month: string;
}): readonly ["settings", "organization-usage", string, string] {
  return ["settings", "organization-usage", input.activeOrganizationId, input.month];
}

export async function getOrganizationUsage(input: {
  month: string;
}): Promise<OrganizationUsageResponse> {
  const response = await requestControlPlane({
    operation: "getOrganizationUsage",
    pathname: "/v1/organization/usage",
    method: "GET",
    query: { month: input.month },
    fallbackMessage: "Could not load usage information.",
  });

  return parseOrganizationUsageResponse(await response.json().catch((): unknown => null));
}

export function resolveCurrentUsageMonth(now = new Date()): string {
  return `${String(now.getUTCFullYear()).padStart(4, "0")}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function parseOrganizationUsageResponse(input: unknown): OrganizationUsageResponse {
  const parsed = OrganizationUsageResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new MembersApiError({
      operation: "parseOrganizationUsageResponse",
      status: 500,
      body: input,
      message: "Usage response payload is invalid.",
      code: null,
    });
  }

  return parsed.data;
}
