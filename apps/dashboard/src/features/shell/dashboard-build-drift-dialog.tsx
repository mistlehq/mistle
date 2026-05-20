import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mistle/ui";
import { useState } from "react";

import type { DashboardBuildDriftStatus } from "../dashboard/dashboard-build-drift.js";
import { reloadDashboardForCurrentRelease } from "../dashboard/dashboard-build-drift.js";

export function DashboardBuildDriftDialog(input: {
  status: DashboardBuildDriftStatus;
}): React.JSX.Element | null {
  const driftNoticeId = resolveDashboardDriftNoticeId(input.status);
  const [dismissedNoticeId, setDismissedNoticeId] = useState<string | null>(null);
  const shouldOpen = driftNoticeId !== null && dismissedNoticeId !== driftNoticeId;

  if (driftNoticeId === null) {
    return null;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      setDismissedNoticeId(driftNoticeId);
    }
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={shouldOpen}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Refresh required</AlertDialogTitle>
          <AlertDialogDescription>
            A new dashboard version is available. Refresh now to load it. If you continue without
            refreshing, some pages may show errors or inconsistent data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Dismiss</AlertDialogCancel>
          <AlertDialogAction onClick={reloadDashboardForCurrentRelease}>
            Refresh now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function resolveDashboardDriftNoticeId(status: DashboardBuildDriftStatus): string | null {
  if (status.kind !== "drift") {
    return null;
  }

  return status.serverReleaseVersion ?? "missing-server-release-version";
}
