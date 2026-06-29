import { useQuery } from "@tanstack/react-query";
import { data } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "../settings/members/members-capabilities-service.js";
import { canViewOrganizationUsageSettings } from "../settings/model.js";
import {
  getOrganizationUsage,
  organizationUsageQueryKey,
  resolveCurrentUsageMonth,
  type OrganizationUsageResponse,
} from "../settings/organization/usage-service.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import {
  OrganizationUsageSettingsPageView,
  type OrganizationUsageBreakdownRow,
  type OrganizationUsageSettingsPageViewProps,
} from "./organization-usage-settings-page-view.js";

export function OrganizationUsageSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const activeOrganizationId = useRequiredOrganizationId();
  const month = resolveCurrentUsageMonth();
  const { title, description } = resolvePageFrameText(pageMeta, "Usage");
  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(activeOrganizationId),
    queryFn: async () => getMembershipCapabilities(),
  });
  const canViewUsageSettings =
    membershipCapabilitiesQuery.data !== undefined &&
    canViewOrganizationUsageSettings({
      organizationRole: membershipCapabilitiesQuery.data.actorRole,
    });
  const usageQuery = useQuery({
    enabled: canViewUsageSettings,
    queryKey: organizationUsageQueryKey({ activeOrganizationId, month }),
    queryFn: async () => getOrganizationUsage({ month }),
  });

  if (membershipCapabilitiesQuery.isPending) {
    return (
      <PageFrame width="normal" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  if (membershipCapabilitiesQuery.isError) {
    throw membershipCapabilitiesQuery.error;
  }

  if (
    !canViewOrganizationUsageSettings({
      organizationRole: membershipCapabilitiesQuery.data.actorRole,
    })
  ) {
    throw data(
      {
        message: "Only organization owners and admins can view usage settings.",
      },
      { status: 403 },
    );
  }

  if (usageQuery.isPending) {
    return (
      <PageFrame width="normal" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  return (
    <PageFrame width="normal">
      {usageQuery.isError ? (
        <p className="text-sm text-destructive">
          {resolveApiErrorMessage({
            error: usageQuery.error,
            fallbackMessage: "Could not load usage information.",
          })}
        </p>
      ) : (
        <OrganizationUsageSettingsPageView {...toUsageViewProps(usageQuery.data)} />
      )}
    </PageFrame>
  );
}

function toUsageViewProps(
  response: OrganizationUsageResponse,
): OrganizationUsageSettingsPageViewProps {
  const totalSandboxHours = response.summary.sandboxHours;

  return {
    period: {
      range: formatPeriodRange(response.period),
    },
    measurement: response.measurement,
    summaryMetrics: [
      {
        id: "sandbox-hours",
        label: "Sandbox hours",
        value: `${formatNumber(response.summary.sandboxHours)}h`,
      },
      {
        id: "sandbox-runs",
        label: "Sandbox runs",
        value: formatInteger(response.summary.sandboxRuns),
      },
      {
        id: "vcpu-hours",
        label: "vCPU hours",
        value: formatNumber(response.summary.vcpuHours),
      },
      {
        id: "memory-gb-hours",
        label: "Memory GB-hours",
        value: formatNumber(response.summary.memoryGbHours),
      },
      {
        id: "storage-gb-hours",
        label: "Storage GB-hours",
        value: formatNumber(response.summary.storageGbHours),
      },
    ],
    dailyUsage: response.dailyUsage.map((point) => ({
      day: formatDayLabel(point.day),
      sandboxHours: point.sandboxHours,
      runCount: point.runCount,
    })),
    profileBreakdown: response.profileBreakdown.map((row) =>
      toBreakdownRow({
        id: row.sandboxProfileId,
        label: row.label,
        sandboxHours: row.sandboxHours,
        sandboxRuns: row.sandboxRuns,
        vcpuHours: row.vcpuHours,
        memoryGbHours: row.memoryGbHours,
        storageGbHours: row.storageGbHours,
        totalSandboxHours,
      }),
    ),
    activityBreakdown: response.activityBreakdown.map((row) =>
      toBreakdownRow({
        id: row.activity,
        label: row.label,
        sandboxHours: row.sandboxHours,
        sandboxRuns: row.sandboxRuns,
        vcpuHours: row.vcpuHours,
        memoryGbHours: row.memoryGbHours,
        storageGbHours: row.storageGbHours,
        totalSandboxHours,
      }),
    ),
  };
}

function toBreakdownRow(input: {
  id: string;
  label: string;
  sandboxHours: number;
  sandboxRuns: number;
  vcpuHours: number;
  memoryGbHours: number;
  storageGbHours: number;
  totalSandboxHours: number;
}): OrganizationUsageBreakdownRow {
  return {
    id: input.id,
    label: input.label,
    detail: "",
    sandboxHours: input.sandboxHours,
    vcpuHours: input.vcpuHours,
    memoryGbHours: input.memoryGbHours,
    storageGbHours: input.storageGbHours,
    sharePercent:
      input.totalSandboxHours === 0
        ? 0
        : Math.round((input.sandboxHours / input.totalSandboxHours) * 100),
    runCount: input.sandboxRuns,
  };
}

function formatPeriodRange(period: { start: string; end: string }): string {
  const start = new Date(period.start);
  const end = new Date(Date.parse(period.end) - 24 * 60 * 60 * 1000);
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${formatMonth(start)} ${String(start.getUTCDate())}-${String(
      end.getUTCDate(),
    )}, ${String(end.getUTCFullYear())}`;
  }

  return `${formatMonthDay(start)}-${formatMonthDay(end)}, ${String(end.getUTCFullYear())}`;
}

function formatMonthDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

function formatDayLabel(day: string): string {
  return formatMonthDay(new Date(`${day}T00:00:00.000Z`));
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}
