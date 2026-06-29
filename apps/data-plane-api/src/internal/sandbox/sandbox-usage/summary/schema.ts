import { z } from "@hono/zod-openapi";

export const SandboxUsageActivities = [
  "user_sessions",
  "designer_sessions",
  "trigger_runs",
  "setup_assistants",
  "setup_script_checks",
  "snapshot_maintenance",
] as const;

export const SandboxUsageActivitySchema = z.enum(SandboxUsageActivities);

export const SandboxUsageSummaryInputSchema = z
  .object({
    organizationId: z.string().min(1),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    requestedAt: z.iso.datetime(),
  })
  .strict();

const SandboxUsageTotalsSchema = z
  .object({
    sandboxHours: z.number().nonnegative(),
    sandboxRuns: z.number().int().nonnegative(),
    vcpuHours: z.number().nonnegative(),
    memoryGbHours: z.number().nonnegative(),
    storageGbHours: z.number().nonnegative(),
  })
  .strict();

const SandboxUsageDailyPointSchema = z
  .object({
    day: z.string().min(1),
    sandboxHours: z.number().nonnegative(),
    runCount: z.number().int().nonnegative(),
  })
  .strict();

const SandboxUsageProfileBreakdownRowSchema = SandboxUsageTotalsSchema.extend({
  sandboxProfileId: z.string().min(1),
}).strict();

const SandboxUsageActivityBreakdownRowSchema = SandboxUsageTotalsSchema.extend({
  activity: SandboxUsageActivitySchema,
}).strict();

export const SandboxUsageSummaryResponseSchema = z
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
    summary: SandboxUsageTotalsSchema,
    dailyUsage: z.array(SandboxUsageDailyPointSchema),
    profileBreakdown: z.array(SandboxUsageProfileBreakdownRowSchema),
    activityBreakdown: z.array(SandboxUsageActivityBreakdownRowSchema),
  })
  .strict();

export type SandboxUsageActivity = z.infer<typeof SandboxUsageActivitySchema>;
export type SandboxUsageSummaryInput = z.infer<typeof SandboxUsageSummaryInputSchema>;
export type SandboxUsageSummaryResponse = z.infer<typeof SandboxUsageSummaryResponseSchema>;
export type SandboxUsageTotals = z.infer<typeof SandboxUsageTotalsSchema>;
