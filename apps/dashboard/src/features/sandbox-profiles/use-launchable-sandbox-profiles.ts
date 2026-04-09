import { useQuery } from "@tanstack/react-query";

import { launchableSandboxProfilesQueryKey } from "./sandbox-profiles-query-keys.js";
import { listLaunchableSandboxProfiles } from "./sandbox-profiles-service.js";
import type { LaunchableSandboxProfilesResult } from "./sandbox-profiles-types.js";

export function useLaunchableSandboxProfiles(input?: {
  enabled?: boolean;
  loadLaunchableProfiles?: (input: {
    signal?: AbortSignal;
  }) => Promise<LaunchableSandboxProfilesResult>;
}) {
  return useQuery({
    queryKey: launchableSandboxProfilesQueryKey(),
    queryFn: async ({ signal }) =>
      (input?.loadLaunchableProfiles ?? listLaunchableSandboxProfiles)({ signal }),
    ...(input?.enabled === undefined ? {} : { enabled: input.enabled }),
  });
}
