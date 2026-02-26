import { useQuery } from "@tanstack/react-query";

import { resolveOrganizationSummaryViewModel } from "./organization-summary-view-model.js";
import { fetchOrganizationSummary, organizationSummaryQueryKey } from "./organization-summary.js";
import { useRequiredOrganizationId } from "./require-auth.js";

export function useOrganizationSummary() {
  const activeOrganizationId = useRequiredOrganizationId();

  const query = useQuery({
    queryKey: organizationSummaryQueryKey(activeOrganizationId),
    queryFn: async () =>
      fetchOrganizationSummary({
        organizationId: activeOrganizationId,
      }),
  });

  const viewModel = resolveOrganizationSummaryViewModel({
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    organizationName: query.data?.name ?? null,
  });

  return {
    ...viewModel,
    activeOrganizationId,
    query,
  };
}
