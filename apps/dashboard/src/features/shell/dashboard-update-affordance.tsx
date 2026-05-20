import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@mistle/ui";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";

import type { DashboardBuildDriftStatus } from "../dashboard/dashboard-build-drift.js";
import { reloadDashboardForCurrentRelease } from "../dashboard/dashboard-build-drift.js";

export function DashboardUpdateAffordance(input: {
  status: DashboardBuildDriftStatus;
}): React.JSX.Element | null {
  if (input.status.kind !== "drift") {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          aria-label="Refresh required. Refresh dashboard"
          className="cursor-pointer bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:text-white active:bg-blue-800 active:text-white focus-visible:ring-blue-500"
          onClick={reloadDashboardForCurrentRelease}
          size="sm"
          tooltip="Refresh dashboard"
          type="button"
        >
          <ArrowsClockwiseIcon aria-hidden className="size-5 shrink-0 md:size-4" />
          <span>Refresh required</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
