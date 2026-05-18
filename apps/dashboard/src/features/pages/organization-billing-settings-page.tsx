import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { data } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useDashboardCapabilitiesQuery } from "../dashboard/dashboard-capabilities-query.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  getMembershipCapabilities,
  membershipCapabilitiesQueryKey,
} from "../settings/members/members-capabilities-service.js";
import { canViewOrganizationBillingSettings } from "../settings/model.js";
import {
  ensureOrganizationBillingCustomer,
  getOrganizationBilling,
  organizationBillingQueryKey,
} from "../settings/organization/billing-service.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationBillingSettingsPageView } from "./organization-billing-settings-page-view.js";

export function OrganizationBillingSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const activeOrganizationId = useRequiredOrganizationId();
  const ensuredOrganizationIdRef = useRef<string | null>(null);
  const { title, description } = resolvePageFrameText(pageMeta, "Billing");

  const dashboardCapabilitiesQuery = useDashboardCapabilitiesQuery();
  const membershipCapabilitiesQuery = useQuery({
    queryKey: membershipCapabilitiesQueryKey(activeOrganizationId),
    queryFn: async () => getMembershipCapabilities(),
  });
  const canViewBillingSettings =
    dashboardCapabilitiesQuery.data !== undefined &&
    membershipCapabilitiesQuery.data !== undefined &&
    canViewOrganizationBillingSettings({
      organizationRole: membershipCapabilitiesQuery.data.actorRole,
      stripeBillingEnabled: dashboardCapabilitiesQuery.data.billing?.stripe.enabled === true,
    });
  const billingQuery = useQuery({
    enabled: canViewBillingSettings,
    queryKey: organizationBillingQueryKey(activeOrganizationId),
    queryFn: async () => getOrganizationBilling(),
  });

  const ensureMutation = useMutation({
    mutationFn: async (organizationId: string) => ({
      organizationId,
      response: await ensureOrganizationBillingCustomer(),
    }),
    onSuccess: async ({ organizationId, response }) => {
      queryClient.setQueryData(organizationBillingQueryKey(organizationId), response);
      await queryClient.invalidateQueries({
        queryKey: organizationBillingQueryKey(organizationId),
      });
    },
  });
  const billingAvailability = billingQuery.data?.available;
  const ensureBillingCustomer = ensureMutation.mutate;
  const ensureBillingCustomerIsPending = ensureMutation.isPending;

  useEffect(() => {
    if (
      billingAvailability !== false ||
      ensuredOrganizationIdRef.current === activeOrganizationId ||
      ensureBillingCustomerIsPending
    ) {
      return;
    }

    ensuredOrganizationIdRef.current = activeOrganizationId;
    ensureBillingCustomer(activeOrganizationId);
  }, [
    activeOrganizationId,
    billingAvailability,
    ensureBillingCustomer,
    ensureBillingCustomerIsPending,
  ]);

  if (dashboardCapabilitiesQuery.isPending || membershipCapabilitiesQuery.isPending) {
    return (
      <PageFrame width="form" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  if (dashboardCapabilitiesQuery.isError) {
    throw dashboardCapabilitiesQuery.error;
  }

  if (membershipCapabilitiesQuery.isError) {
    throw membershipCapabilitiesQuery.error;
  }

  if (dashboardCapabilitiesQuery.data.billing?.stripe.enabled !== true) {
    throw data(
      {
        message: "Billing is not available.",
      },
      { status: 404 },
    );
  }

  if (
    !canViewOrganizationBillingSettings({
      organizationRole: membershipCapabilitiesQuery.data.actorRole,
      stripeBillingEnabled: true,
    })
  ) {
    throw data(
      {
        message: "Only organization owners and admins can view billing settings.",
      },
      { status: 403 },
    );
  }

  if (billingQuery.isPending) {
    return (
      <PageFrame width="form" description={description} title={title}>
        {null}
      </PageFrame>
    );
  }

  return (
    <PageFrame width="form" description={description} title={title}>
      <OrganizationBillingSettingsPageView
        billing={billingQuery.data ?? { available: false }}
        loadErrorMessage={
          billingQuery.isError
            ? resolveApiErrorMessage({
                error: billingQuery.error,
                fallbackMessage: "Could not load billing information.",
              })
            : ensureMutation.isError &&
                ensureMutation.variables === activeOrganizationId &&
                billingAvailability === false
              ? resolveApiErrorMessage({
                  error: ensureMutation.error,
                  fallbackMessage: "Could not prepare billing information.",
                })
              : null
        }
      />
    </PageFrame>
  );
}
