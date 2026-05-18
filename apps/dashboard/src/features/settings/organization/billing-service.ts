import { z } from "zod";

import { requestControlPlane } from "../../api/request-control-plane.js";
import { MembersApiError } from "../members/members-api-errors.js";

const OrganizationBillingResponseSchema = z.union([
  z
    .object({
      available: z.literal(false),
    })
    .strict(),
  z
    .object({
      available: z.literal(true),
      organization: z
        .object({
          name: z.string().min(1),
          stripeCustomerId: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

export type OrganizationBillingResponse = z.infer<typeof OrganizationBillingResponseSchema>;

export function organizationBillingQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "organization-billing", string] {
  return ["settings", "organization-billing", activeOrganizationId];
}

export async function getOrganizationBilling(): Promise<OrganizationBillingResponse> {
  const response = await requestControlPlane({
    operation: "getOrganizationBilling",
    pathname: "/v1/organization/billing",
    method: "GET",
    fallbackMessage: "Could not load billing information.",
  });

  return parseOrganizationBillingResponse(await response.json().catch((): unknown => null));
}

export async function ensureOrganizationBillingCustomer(): Promise<OrganizationBillingResponse> {
  const response = await requestControlPlane({
    operation: "ensureOrganizationBillingCustomer",
    pathname: "/v1/organization/billing/customer",
    method: "POST",
    fallbackMessage: "Could not prepare billing information.",
  });

  return parseOrganizationBillingResponse(await response.json().catch((): unknown => null));
}

function parseOrganizationBillingResponse(input: unknown): OrganizationBillingResponse {
  const parsed = OrganizationBillingResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new MembersApiError({
      operation: "parseOrganizationBillingResponse",
      status: 500,
      body: input,
      message: "Billing response payload is invalid.",
      code: null,
    });
  }

  return parsed.data;
}
