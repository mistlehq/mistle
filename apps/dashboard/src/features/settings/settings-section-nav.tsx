import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { useDashboardCapabilitiesQuery } from "../dashboard/dashboard-capabilities-query.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "./members/members-capabilities-service.js";
import { resolveSettingsNavGroups } from "./model.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";

export function SettingsSectionNav(): React.JSX.Element {
  const location = useLocation();
  const activeOrganizationId = useRequiredOrganizationId();
  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(activeOrganizationId),
    queryFn: async () => getMembershipCapabilities(),
  });
  const dashboardCapabilitiesQuery = useDashboardCapabilitiesQuery();
  const groups = resolveSettingsNavGroups({
    organizationRole: membershipCapabilitiesQuery.data?.actorRole ?? null,
    stripeBillingEnabled: dashboardCapabilitiesQuery.data?.billing?.stripe.enabled === true,
  });

  return <SettingsSectionNavView groups={groups} pathname={location.pathname} />;
}
