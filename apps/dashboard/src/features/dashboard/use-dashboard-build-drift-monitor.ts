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

    function checkVisibleBuild(): void {
      if (document.visibilityState === "visible") {
        checkCurrentBuild();
      }
    }

    checkCurrentBuild();
    globalThis.addEventListener("focus", checkCurrentBuild);
    document.addEventListener("visibilitychange", checkVisibleBuild);

    return () => {
      abortController.abort();
      globalThis.removeEventListener("focus", checkCurrentBuild);
      document.removeEventListener("visibilitychange", checkVisibleBuild);
    };
  }, []);

  return status;
}
