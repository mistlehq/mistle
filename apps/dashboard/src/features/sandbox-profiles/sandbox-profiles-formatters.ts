import { formatRelativeOrDate } from "../shared/date-formatters.js";
import type { SandboxProfileStatus } from "./sandbox-profiles-types.js";

type SandboxProfileStatusBadgeVariant = "secondary" | "outline";

type SandboxProfileStatusUi = {
  label: string;
  badgeVariant: SandboxProfileStatusBadgeVariant;
  badgeClassName: string | undefined;
};

const SANDBOX_PROFILE_STATUS_UI: Record<SandboxProfileStatus, SandboxProfileStatusUi> = {
  active: {
    label: "Active",
    badgeVariant: "secondary",
    badgeClassName: "bg-emerald-600 text-white hover:bg-emerald-600/90",
  },
  inactive: {
    label: "Inactive",
    badgeVariant: "outline",
    badgeClassName: undefined,
  },
};

export const SANDBOX_PROFILE_STATUS_OPTIONS: readonly SandboxProfileStatus[] = [
  "active",
  "inactive",
];

export function isSandboxProfileStatus(value: string): value is SandboxProfileStatus {
  return value === "active" || value === "inactive";
}

export function formatSandboxProfileStatus(status: SandboxProfileStatus): string {
  return SANDBOX_PROFILE_STATUS_UI[status].label;
}

export function getSandboxProfileStatusBadgeUi(status: SandboxProfileStatus): {
  variant: SandboxProfileStatusBadgeVariant;
  className: string | undefined;
} {
  return {
    variant: SANDBOX_PROFILE_STATUS_UI[status].badgeVariant,
    className: SANDBOX_PROFILE_STATUS_UI[status].badgeClassName,
  };
}

export function formatSandboxProfileUpdatedAt(isoDateTime: string): string {
  return formatRelativeOrDate(isoDateTime);
}
