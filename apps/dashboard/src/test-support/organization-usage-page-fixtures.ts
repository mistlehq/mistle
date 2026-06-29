import type { OrganizationUsageSettingsPageViewProps } from "../features/pages/organization-usage-settings-page-view.js";

export function createOrganizationUsagePrototypeProps(): OrganizationUsageSettingsPageViewProps {
  return {
    period: {
      range: "Jun 1-30, 2026",
    },
    measurement: {
      notice: null,
    },
    summaryMetrics: [
      {
        id: "sandbox-hours",
        label: "Sandbox hours",
        value: "312.4h",
      },
      {
        id: "sandbox-runs",
        label: "Sandbox runs",
        value: "186",
      },
      {
        id: "vcpu-hours",
        label: "vCPU hours",
        value: "784.2",
      },
      {
        id: "memory-gb-hours",
        label: "Memory GB-hours",
        value: "2,109.6",
      },
      {
        id: "storage-gb-hours",
        label: "Storage GB-hours",
        value: "8,812.8",
      },
    ],
    dailyUsage: createJuneDailyUsage(),
    profileBreakdown: [
      {
        id: "profile-pr-review",
        label: "PR review agent",
        detail: "",
        sandboxHours: 128.2,
        vcpuHours: 512.8,
        memoryGbHours: 1_025.6,
        storageGbHours: 5_128,
        sharePercent: 41,
        runCount: 75,
      },
      {
        id: "profile-designer",
        label: "Mistle Designer",
        detail: "",
        sandboxHours: 82.7,
        vcpuHours: 165.4,
        memoryGbHours: 330.8,
        storageGbHours: 1_654,
        sharePercent: 26,
        runCount: 39,
      },
      {
        id: "profile-release",
        label: "Release checklist agent",
        detail: "",
        sandboxHours: 57.5,
        vcpuHours: 115,
        memoryGbHours: 460,
        storageGbHours: 1_150,
        sharePercent: 18,
        runCount: 18,
      },
      {
        id: "profile-research",
        label: "Research assistant",
        detail: "",
        sandboxHours: 44,
        vcpuHours: 88,
        memoryGbHours: 293.2,
        storageGbHours: 880,
        sharePercent: 14,
        runCount: 34,
      },
    ],
    activityBreakdown: [
      {
        id: "activity-user-sessions",
        label: "User sessions",
        detail: "",
        sandboxHours: 94.4,
        vcpuHours: 236.2,
        memoryGbHours: 551.5,
        storageGbHours: 2_140,
        sharePercent: 30,
        runCount: 117,
      },
      {
        id: "activity-designer-sessions",
        label: "Designer sessions",
        detail: "",
        sandboxHours: 92.1,
        vcpuHours: 184.2,
        memoryGbHours: 552.6,
        storageGbHours: 1_842,
        sharePercent: 29,
        runCount: 42,
      },
      {
        id: "activity-trigger-runs",
        label: "Trigger runs",
        detail: "",
        sandboxHours: 79.4,
        vcpuHours: 317.6,
        memoryGbHours: 635.2,
        storageGbHours: 3_176,
        sharePercent: 25,
        runCount: 29,
      },
      {
        id: "activity-setup-assistants",
        label: "Setup assistants",
        detail: "",
        sandboxHours: 31.2,
        vcpuHours: 62.4,
        memoryGbHours: 249.6,
        storageGbHours: 624,
        sharePercent: 10,
        runCount: 8,
      },
      {
        id: "activity-setup-script-checks",
        label: "Setup script checks",
        detail: "",
        sandboxHours: 9.8,
        vcpuHours: 19.6,
        memoryGbHours: 78.4,
        storageGbHours: 196,
        sharePercent: 3,
        runCount: 9,
      },
      {
        id: "activity-snapshot-maintenance",
        label: "Snapshot maintenance",
        detail: "",
        sandboxHours: 5.5,
        vcpuHours: 11,
        memoryGbHours: 42.3,
        storageGbHours: 110,
        sharePercent: 2,
        runCount: 5,
      },
    ],
  };
}

export function createOrganizationUsageEmptyMeasuredProps(): OrganizationUsageSettingsPageViewProps {
  return {
    period: {
      range: "Jun 1-30, 2026",
    },
    measurement: {
      notice: null,
    },
    summaryMetrics: [
      {
        id: "sandbox-hours",
        label: "Sandbox hours",
        value: "0.0h",
      },
      {
        id: "sandbox-runs",
        label: "Sandbox runs",
        value: "0",
      },
      {
        id: "vcpu-hours",
        label: "vCPU hours",
        value: "0.0",
      },
      {
        id: "memory-gb-hours",
        label: "Memory GB-hours",
        value: "0.0",
      },
      {
        id: "storage-gb-hours",
        label: "Storage GB-hours",
        value: "0.0",
      },
    ],
    dailyUsage: createJuneDailyUsage().map((point) => ({
      ...point,
      sandboxHours: 0,
      runCount: 0,
    })),
    profileBreakdown: [],
    activityBreakdown: [
      createEmptyActivityRow("activity-user-sessions", "User sessions"),
      createEmptyActivityRow("activity-designer-sessions", "Designer sessions"),
      createEmptyActivityRow("activity-trigger-runs", "Trigger runs"),
      createEmptyActivityRow("activity-setup-assistants", "Setup assistants"),
      createEmptyActivityRow("activity-setup-script-checks", "Setup script checks"),
      createEmptyActivityRow("activity-snapshot-maintenance", "Snapshot maintenance"),
    ],
  };
}

function createJuneDailyUsage(): OrganizationUsageSettingsPageViewProps["dailyUsage"] {
  return [
    { day: "Jun 1", sandboxHours: 7.4, runCount: 5 },
    { day: "Jun 2", sandboxHours: 10.6, runCount: 6 },
    { day: "Jun 3", sandboxHours: 8.9, runCount: 4 },
    { day: "Jun 4", sandboxHours: 12.8, runCount: 9 },
    { day: "Jun 5", sandboxHours: 13.1, runCount: 8 },
    { day: "Jun 6", sandboxHours: 16.4, runCount: 10 },
    { day: "Jun 7", sandboxHours: 18.6, runCount: 11 },
    { day: "Jun 8", sandboxHours: 14.3, runCount: 7 },
    { day: "Jun 9", sandboxHours: 11.2, runCount: 6 },
    { day: "Jun 10", sandboxHours: 9.7, runCount: 7 },
    { day: "Jun 11", sandboxHours: 15.5, runCount: 9 },
    { day: "Jun 12", sandboxHours: 18.9, runCount: 11 },
    { day: "Jun 13", sandboxHours: 21.9, runCount: 14 },
    { day: "Jun 14", sandboxHours: 17.8, runCount: 8 },
    { day: "Jun 15", sandboxHours: 22.6, runCount: 13 },
    { day: "Jun 16", sandboxHours: 34.2, runCount: 18 },
    { day: "Jun 17", sandboxHours: 31.6, runCount: 17 },
    { day: "Jun 18", sandboxHours: 26.7, runCount: 15 },
    { day: "Jun 19", sandboxHours: 28.4, runCount: 16 },
    { day: "Jun 20", sandboxHours: 30.9, runCount: 18 },
    { day: "Jun 21", sandboxHours: 37.2, runCount: 19 },
    { day: "Jun 22", sandboxHours: 45.8, runCount: 21 },
    { day: "Jun 23", sandboxHours: 41.4, runCount: 20 },
    { day: "Jun 24", sandboxHours: 36.5, runCount: 18 },
    { day: "Jun 25", sandboxHours: 39.1, runCount: 19 },
    { day: "Jun 26", sandboxHours: 32.4, runCount: 16 },
    { day: "Jun 27", sandboxHours: 29.2, runCount: 14 },
    { day: "Jun 28", sandboxHours: 33.6, runCount: 17 },
    { day: "Jun 29", sandboxHours: 24.8, runCount: 13 },
    { day: "Jun 30", sandboxHours: 27.3, runCount: 12 },
  ];
}

function createEmptyActivityRow(
  id: string,
  label: string,
): OrganizationUsageSettingsPageViewProps["activityBreakdown"][number] {
  return {
    id,
    label,
    detail: "",
    sandboxHours: 0,
    vcpuHours: 0,
    memoryGbHours: 0,
    storageGbHours: 0,
    sharePercent: 0,
    runCount: 0,
  };
}
