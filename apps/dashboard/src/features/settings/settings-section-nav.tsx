import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";

import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "./members/members-capabilities-service.js";
import { resolveSettingsNavGroups } from "./model.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";

export function SettingsSectionNav(): React.JSX.Element {
  const location = useLocation();
  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(),
    queryFn: async () => getMembershipCapabilities(),
  });
  const groups = resolveSettingsNavGroups({
    organizationRole: membershipCapabilitiesQuery.data?.actorRole ?? null,
  });

  return <SettingsSectionNavView groups={groups} pathname={location.pathname} />;
}
