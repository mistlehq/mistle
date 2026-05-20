import { useEffect } from "react";

import { checkDashboardBuildDrift, useDashboardBuildDriftStatus } from "./dashboard-build-drift.js";

export function useDashboardBuildDriftMonitor() {
  const status = useDashboardBuildDriftStatus();

  useEffect(() => {
    let abortController = new AbortController();

    function checkCurrentBuild(): void {
      abortController.abort();
      abortController = new AbortController();
      void checkDashboardBuildDrift({ signal: abortController.signal }).catch(() => {});
    }

    checkCurrentBuild();
    globalThis.addEventListener("focus", checkCurrentBuild);

    return () => {
      abortController.abort();
      globalThis.removeEventListener("focus", checkCurrentBuild);
    };
  }, []);

  return status;
}
