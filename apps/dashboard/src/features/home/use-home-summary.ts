import { useQuery } from "@tanstack/react-query";

import { HOME_SUMMARY_QUERY_KEY } from "./home-query-keys.js";
import { getHomeSummary } from "./home-service.js";

export function useHomeSummary() {
  return useQuery({
    queryKey: HOME_SUMMARY_QUERY_KEY,
    queryFn: async ({ signal }) => getHomeSummary({ signal }),
  });
}
