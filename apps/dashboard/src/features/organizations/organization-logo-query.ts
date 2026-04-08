import { useQuery } from "@tanstack/react-query";

import { getOrganizationLogo } from "../settings/organization/organization-logo-service.js";

const ORGANIZATION_LOGO_QUERY_KEY_PREFIX: readonly ["organization", "logo"] = [
  "organization",
  "logo",
];

export function organizationLogoQueryKey(
  organizationId: string,
): readonly ["organization", "logo", string] {
  return [
    ORGANIZATION_LOGO_QUERY_KEY_PREFIX[0],
    ORGANIZATION_LOGO_QUERY_KEY_PREFIX[1],
    organizationId,
  ];
}

export function useOrganizationLogoQuery(organizationId: string) {
  return useQuery({
    queryKey: organizationLogoQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationLogo({
        organizationId,
      }),
    staleTime: 15 * 60 * 1000,
  });
}
