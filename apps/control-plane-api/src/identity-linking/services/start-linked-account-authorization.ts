import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { type IntegrationRegistry } from "@mistle/integrations-core";

import { resolveMasterEncryptionKeyMaterial } from "../../lib/crypto.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { resolveIdentityLinkingRuntimeContextOrThrow } from "./identity-linking-definition.js";
import {
  buildIdentityLinkCallbackUrl,
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  persistIdentityLinkRedirectSession,
} from "./redirect-flow.js";
import { resolveIdentityLinkProviderContextOrThrow } from "./resolve-identity-link-provider-context.js";
import {
  resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow,
  resolveOrganizationIdentityLinkProviderConfigByIdOrThrow,
} from "./resolve-organization-identity-link-provider-config.js";

export type StartedLinkedAccountAuthorization = {
  authorizationUrl: string;
  expiresAt: string;
};

function resolveIdentityLinkingErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error;
  return typeof code === "string" ? code : undefined;
}

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
    organizationProviderConfigId: string;
    controlPlaneBaseUrl: string;
  },
): Promise<StartedLinkedAccountAuthorization> {
  const config = await resolveOrganizationIdentityLinkProviderConfigByIdOrThrow(
    {
      db: ctx.db,
    },
    {
      organizationId: input.organizationId,
      organizationProviderConfigId: input.organizationProviderConfigId,
    },
  );
  const providerContext = await resolveIdentityLinkProviderContextOrThrow(ctx, {
    organizationId: input.organizationId,
    providerFamily: config.providerFamily,
    organizationProviderConfigId: config.id,
    requiredConfigStatus: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
  });

  const identityLinkingRuntime = await resolveIdentityLinkingRuntimeContextOrThrow({
    db: ctx.db,
    integrationRegistry: ctx.integrationRegistry,
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
    },
    organizationId: input.organizationId,
    integrationTarget: providerContext.integrationTarget,
    integrationConnection: providerContext.integrationConnection,
  });

  if (identityLinkingRuntime.identityLinking.startAuthorization === undefined) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_ADAPTER_NOT_IMPLEMENTED,
      `Identity-linking provider '${config.providerFamily}' does not yet support linked-account authorization.`,
    );
  }

  const state = createRedirectState();
  const redirectUrl = buildIdentityLinkCallbackUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    providerFamily: config.providerFamily,
  });
  let startedAuthorization;
  try {
    startedAuthorization = await identityLinkingRuntime.identityLinking.startAuthorization({
      organizationId: input.organizationId,
      userId: input.userId,
      providerFamily: config.providerFamily,
      target: identityLinkingRuntime.target,
      connection: identityLinkingRuntime.connection,
      state,
      redirectUrl,
      resolveConnectionSecret: identityLinkingRuntime.resolveConnectionSecret,
    });
  } catch (error) {
    if (resolveIdentityLinkingErrorCode(error) === "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG") {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        error instanceof Error ? error.message : "Identity-linking provider config is invalid.",
      );
    }

    throw error;
  }

  const expiresAt = createRedirectSessionExpiryTimestamp();
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: ctx.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: ctx.integrationsConfig.masterEncryptionKeys,
  });

  await persistIdentityLinkRedirectSession({
    db: ctx.db,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: config.providerFamily,
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

export async function startLinkedAccountAuthorizationForProviderFamily(
  ctx: Parameters<typeof startLinkedAccountAuthorization>[0],
  input: {
    organizationId: string;
    userId: string;
    providerFamily: string;
    controlPlaneBaseUrl: string;
  },
): Promise<StartedLinkedAccountAuthorization> {
  const config = await resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow(
    {
      db: ctx.db,
    },
    {
      organizationId: input.organizationId,
      providerFamily: input.providerFamily,
    },
  );

  return startLinkedAccountAuthorization(ctx, {
    organizationId: input.organizationId,
    userId: input.userId,
    organizationProviderConfigId: config.id,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
  });
}
