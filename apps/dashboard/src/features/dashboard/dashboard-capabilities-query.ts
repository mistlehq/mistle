import { useQuery } from "@tanstack/react-query";

import { getDashboardCapabilities } from "./dashboard-capabilities-service.js";

export const DASHBOARD_CAPABILITIES_QUERY_KEY: readonly ["dashboard", "capabilities"] = [
  "dashboard",
  "capabilities",
];

export function useDashboardCapabilitiesQuery() {
  return useQuery({
    queryKey: DASHBOARD_CAPABILITIES_QUERY_KEY,
    queryFn: async ({ signal }) => getDashboardCapabilities({ signal }),
  });
}
