import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import {
  type OrganizationIdentityLinkProviderConfig,
  listOrganizationIdentityLinkProviders,
} from "./list-organization-identity-link-providers.js";

export async function buildOrganizationIdentityLinkProviderConfigResponse(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    organizationProviderConfigId: string;
  },
): Promise<OrganizationIdentityLinkProviderConfig> {
  const providers = await listOrganizationIdentityLinkProviders(ctx, {
    organizationId: input.organizationId,
  });

  for (const provider of providers) {
    const config = provider.configs.find(
      (entry) => entry.organizationProviderConfigId === input.organizationProviderConfigId,
    );
    if (config !== undefined) {
      return config;
    }
  }

  throw new Error(
    `Failed to load organization identity-link provider config '${input.organizationProviderConfigId}'.`,
  );
}
