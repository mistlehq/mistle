import { z } from "@hono/zod-openapi";

export const OrganizationUsageResponseSchema = z
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
