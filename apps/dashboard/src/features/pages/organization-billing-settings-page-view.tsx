import { DefinitionList, Notice } from "@mistle/ui";

import type { OrganizationBillingResponse } from "../settings/organization/billing-service.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationBillingSettingsPageViewProps = {
  billing: OrganizationBillingResponse;
  loadErrorMessage: string | null;
};

export function OrganizationBillingSettingsPageView(
  props: OrganizationBillingSettingsPageViewProps,
): React.JSX.Element {
  if (props.loadErrorMessage !== null) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  if (!props.billing.available) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <Notice>Billing information is not available yet.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <FormPageStack>
      <FormPageSection>
        <DefinitionList
          className="p-4"
          items={[
            {
              id: "organization-name",
              label: "Organization name",
              value: props.billing.organization.name,
            },
            {
              id: "stripe-customer-id",
              label: "Stripe customer ID",
              value: props.billing.organization.stripeCustomerId,
            },
          ]}
        />
      </FormPageSection>
    </FormPageStack>
  );
}
