import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { resolveMasterEncryptionKeyMaterial } from "../../lib/crypto.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { resolveIdentityLinkProviderAdapter } from "./provider-adapters.js";
import {
  buildIdentityLinkCallbackUrl,
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  persistIdentityLinkRedirectSession,
} from "./redirect-flow.js";
import { resolveIdentityLinkProviderContextOrThrow } from "./resolve-identity-link-provider-context.js";

export type StartedLinkedAccountAuthorization = {
  authorizationUrl: string;
  expiresAt: string;
};

export async function startLinkedAccountAuthorization(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    userId: string;
    providerFamily: string;
    controlPlaneBaseUrl: string;
  },
): Promise<StartedLinkedAccountAuthorization> {
  const providerContext = await resolveIdentityLinkProviderContextOrThrow(ctx, {
    organizationId: input.organizationId,
    providerFamily: input.providerFamily,
    requiredConfigStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
  });

  const providerAdapter = resolveIdentityLinkProviderAdapter(input.providerFamily);
  if (providerAdapter === undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_ADAPTER_NOT_IMPLEMENTED,
      `Identity-linking provider '${input.providerFamily}' does not yet support linked-account authorization.`,
    );
  }

  const state = createRedirectState();
  const redirectUrl = buildIdentityLinkCallbackUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    providerFamily: input.providerFamily,
  });
  const startedAuthorization = await providerAdapter.startAuthorization({
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: input.providerFamily,
    organizationProviderConfig: providerContext.organizationProviderConfig,
    integrationConnection: providerContext.integrationConnection,
    integrationTarget: providerContext.integrationTarget,
    state,
    redirectUrl,
  });

  const expiresAt = createRedirectSessionExpiryTimestamp();
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });

  await persistIdentityLinkRedirectSession({
    db: ctx.db,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: input.providerFamily,
    organizationProviderConfigId: providerContext.organizationProviderConfig.id,
    integrationConnectionId: providerContext.integrationConnection.id,
    state,
    ...(startedAuthorization.pkceVerifier === undefined
      ? {}
      : { pkceVerifier: startedAuthorization.pkceVerifier }),
    ...(startedAuthorization.providerState === undefined
      ? {}
      : { providerState: startedAuthorization.providerState }),
    expiresAt,
    masterKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeyMaterial,
  });

  return {
    authorizationUrl: startedAuthorization.authorizationUrl,
    expiresAt,
  };
}
