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
import { useEffect, useState } from "react";

import type { DashboardBuildDriftStatus } from "../dashboard/dashboard-build-drift.js";
import { reloadDashboardForCurrentRelease } from "../dashboard/dashboard-build-drift.js";

export function DashboardBuildDriftDialog(input: {
  schemaMismatchPromptRevision: number;
  status: DashboardBuildDriftStatus;
}): React.JSX.Element | null {
  const [dismissedPromptRevision, setDismissedPromptRevision] = useState(0);
  const shouldOpen =
    input.status.kind === "drift" &&
    input.schemaMismatchPromptRevision > 0 &&
    dismissedPromptRevision < input.schemaMismatchPromptRevision;

  useEffect(() => {
    if (input.status.kind !== "drift") {
      setDismissedPromptRevision(input.schemaMismatchPromptRevision);
    }
  }, [input.schemaMismatchPromptRevision, input.status.kind]);

  if (input.status.kind !== "drift" || input.schemaMismatchPromptRevision === 0) {
    return null;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) {
      setDismissedPromptRevision(input.schemaMismatchPromptRevision);
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
