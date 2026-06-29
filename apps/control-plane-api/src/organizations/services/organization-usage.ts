import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { inArray } from "drizzle-orm";

import { DESIGNER_RUNTIME_PROFILE_ID } from "../../designer/constants.js";
import type { OrganizationUsageResponse } from "./organization-usage-contract.js";

type ReadOrganizationUsageContext = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "readSandboxUsageSummary">;
};

type ReadOrganizationUsageInput = {
  organizationId: string;
  month: string;
  requestedAt: string;
};

const ActivityLabels = {
  user_sessions: "User sessions",
  designer_sessions: "Designer sessions",
  trigger_runs: "Trigger runs",
  setup_assistants: "Setup assistants",
  setup_script_checks: "Setup script checks",
  snapshot_maintenance: "Snapshot maintenance",
} as const;

export async function readOrganizationUsage(
  ctx: ReadOrganizationUsageContext,
  input: ReadOrganizationUsageInput,
): Promise<OrganizationUsageResponse> {
  const period = resolveCalendarMonthPeriod(input.month);
  const usage = await ctx.dataPlaneClient.readSandboxUsageSummary({
    organizationId: input.organizationId,
    periodStart: period.start,
    periodEnd: period.end,
    requestedAt: input.requestedAt,
  });
  const profileNames = await resolveProfileNames(ctx.db, {
    organizationId: input.organizationId,
    profileIds: usage.profileBreakdown.map((row) => row.sandboxProfileId),
  });

  return {
    period: usage.period,
    measurement: usage.measurement,
    summary: usage.summary,
    dailyUsage: usage.dailyUsage,
    profileBreakdown: usage.profileBreakdown.map((row) => ({
      sandboxProfileId: row.sandboxProfileId,
      label: resolveUsageProfileLabel({
        profileNames,
        sandboxProfileId: row.sandboxProfileId,
      }),
      sandboxHours: row.sandboxHours,
      sandboxRuns: row.sandboxRuns,
      vcpuHours: row.vcpuHours,
      memoryGbHours: row.memoryGbHours,
      storageGbHours: row.storageGbHours,
    })),
    activityBreakdown: usage.activityBreakdown.map((row) => ({
      activity: row.activity,
      label: ActivityLabels[row.activity],
      sandboxHours: row.sandboxHours,
      sandboxRuns: row.sandboxRuns,
      vcpuHours: row.vcpuHours,
      memoryGbHours: row.memoryGbHours,
      storageGbHours: row.storageGbHours,
    })),
  };
}

function resolveCalendarMonthPeriod(month: string): { start: string; end: string } {
  const [yearText, monthText] = month.split("-");
  if (yearText === undefined || monthText === undefined) {
    throw new Error("Usage month must use YYYY-MM format.");
  }

  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    throw new Error("Usage month must use YYYY-MM format.");
  }

  return {
    start: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  };
}

async function resolveProfileNames(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    profileIds: readonly string[];
  },
): Promise<Map<string, string>> {
  const profileIds = Array.from(new Set(input.profileIds));
  if (profileIds.length === 0) {
    return new Map();
  }

  const profiles = await db.query.sandboxProfiles.findMany({
    columns: {
      id: true,
      displayName: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), inArray(table.id, profileIds)),
  });

  return new Map(profiles.map((profile) => [profile.id, profile.displayName]));
}

export function resolveUsageProfileLabel(input: {
  profileNames: ReadonlyMap<string, string>;
  sandboxProfileId: string;
}): string {
  const profileName = input.profileNames.get(input.sandboxProfileId);
  if (profileName !== undefined) {
    return profileName;
  }

  if (input.sandboxProfileId === DESIGNER_RUNTIME_PROFILE_ID) {
    return "Mistle Designer";
  }

  return "Deleted sandbox profile";
}
