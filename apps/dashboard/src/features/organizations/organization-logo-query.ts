import { useQuery } from "@tanstack/react-query";

import { getOrganizationLogo } from "../settings/organization/organization-logo-service.js";

const ORGANIZATION_LOGO_QUERY_KEY_PREFIX: readonly ["organization", "logo"] = [
  "organization",
  "logo",
];

export function organizationLogoQueryKey(
  activeOrganizationId: string,
): readonly ["organization", "logo", string] {
  return [
    ORGANIZATION_LOGO_QUERY_KEY_PREFIX[0],
    ORGANIZATION_LOGO_QUERY_KEY_PREFIX[1],
    activeOrganizationId,
  ];
}

export function useOrganizationLogoQuery(activeOrganizationId: string) {
  return useQuery({
    queryKey: organizationLogoQueryKey(activeOrganizationId),
    queryFn: async () => getOrganizationLogo(),
    staleTime: 15 * 60 * 1000,
  });
}
