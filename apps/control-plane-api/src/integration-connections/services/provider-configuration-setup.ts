import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type {
  AnyIntegrationDefinition,
  IntegrationProviderConfigurationSetupFlowCapability,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../../internal/integration-credentials/services/errors.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import type { ParsedFormSecret } from "./form-connection-methods.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionConfigOrThrow,
  resolveConnectionSecretsOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "./webhook-sources.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());

export type ConnectionWithTargetForProviderConfigurationSetup = {
  id: string;
  organizationId: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  config: Record<string, unknown> | null;
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: boolean;
    config: Record<string, unknown>;
    secrets: {
      ciphertext: string;
      nonce: string;
      masterKeyVersion: number;
    } | null;
  };
};

export async function resolveConnectionWithTargetForProviderConfigurationSetup(input: {
  connectionId: string;
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<ConnectionWithTargetForProviderConfigurationSetup | undefined> {
  return input.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
    with: {
      target: true,
    },
  });
}

function resolveProviderConfigurationSetupFlowOrThrow(input: {
  definition: AnyIntegrationDefinition;
  methodId: string;
  routeSegment: string;
}): IntegrationProviderConfigurationSetupFlowCapability {
  const flow = input.definition.providerConfigurationSetup?.flows.find(
    (candidate) =>
      candidate.methodId === input.methodId && candidate.routeSegment === input.routeSegment,
  );

  if (flow === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration setup flow '${input.methodId}/${input.routeSegment}' does not support provider configuration setup.`,
    );
  }

  return flow;
}

async function resolveExistingConnectionSecrets(input: {
  connection: ConnectionWithTargetForProviderConfigurationSetup;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<Record<string, string>> {
  try {
    return await resolveConnectionSecretsOrThrow({
      db: input.db,
      integrationRegistry: input.integrationRegistry,
      integrationsConfig: input.integrationsConfig,
      connection: input.connection,
    });
  } catch (error) {
    if (
      error instanceof InternalIntegrationCredentialsError &&
      error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
    ) {
      return {};
    }

    throw error;
  }
}

function buildSubmittedConnectionSecrets(input: {
  parsedSecrets: readonly ParsedFormSecret[];
}): Record<string, string> {
  const secrets: Record<string, string> = {};

  for (const parsedSecret of input.parsedSecrets) {
    secrets[parsedSecret.field.name] = parsedSecret.normalizedValue;
  }

  return secrets;
}

async function resolveProviderConfigurationWebhookCallbackUrl(input: {
  connection: ConnectionWithTargetForProviderConfigurationSetup;
  controlPlaneBaseUrl: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): Promise<string | undefined> {
  const { webhookSourceCapability, parsedTargetConfig, parsedTargetSecrets } =
    resolveWebhookSourceCapabilityOrThrow({
      integrationRegistry: input.integrationRegistry,
      integrationsConfig: input.integrationsConfig,
      target: input.connection.target,
    });
  const webhookSource = await ensureImplicitConnectionWebhookSource({
    db: input.db,
    organizationId: input.connection.organizationId,
    connectionId: input.connection.id,
    targetKey: input.connection.targetKey,
  });
  const descriptor = await webhookSourceCapability.describeSource({
    organizationId: input.connection.organizationId,
    targetKey: input.connection.targetKey,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    target: {
      familyId: input.connection.target.familyId,
      variantId: input.connection.target.variantId,
      enabled: input.connection.target.enabled,
      config: parsedTargetConfig,
      secrets: parsedTargetSecrets,
    },
    connection: {
      id: input.connection.id,
      status: input.connection.status,
      config: resolveConnectionConfigOrThrow({
        connectionId: input.connection.id,
        config: input.connection.config,
      }),
    },
    source: {
      id: webhookSource.id,
      targetKey: webhookSource.targetKey,
      organizationId: webhookSource.organizationId,
      integrationConnectionId: webhookSource.integrationConnectionId,
      endpointKey: webhookSource.endpointKey,
      providerMetadata: webhookSource.providerMetadata,
      ...(webhookSource.displayName === null || webhookSource.displayName === undefined
        ? {}
        : { displayName: webhookSource.displayName }),
      ...(webhookSource.remoteRegistrationId === null ||
      webhookSource.remoteRegistrationId === undefined
        ? {}
        : { remoteRegistrationId: webhookSource.remoteRegistrationId }),
    },
  });

  return descriptor.callbackUrl;
}

export async function completeProviderConfigurationSetup(
  ctx: {
    controlPlaneBaseUrl: string;
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: {
    connection: ConnectionWithTargetForProviderConfigurationSetup;
    definition: AnyIntegrationDefinition;
    methodId: string;
    parsedConfig: Record<string, unknown>;
    parsedSecrets: readonly ParsedFormSecret[];
    routeSegment: string;
  },
): Promise<void> {
  const flow = resolveProviderConfigurationSetupFlowOrThrow({
    definition: input.definition,
    methodId: input.methodId,
    routeSegment: input.routeSegment,
  });
  const existingConnectionSecrets = await resolveExistingConnectionSecrets({
    connection: input.connection,
    db: ctx.db,
    integrationRegistry: ctx.integrationRegistry,
    integrationsConfig: ctx.integrationsConfig,
  });
  const connectionSecrets = {
    ...existingConnectionSecrets,
    ...buildSubmittedConnectionSecrets({
      parsedSecrets: input.parsedSecrets,
    }),
  };
  const parsedTargetConfig = UnknownRecordSchema.parse(
    input.definition.targetConfigSchema.parse(input.connection.target.config),
  );
  const parsedTargetSecrets = StringRecordSchema.parse(
    input.definition.targetSecretSchema.parse(
      resolveIntegrationTargetSecrets({
        integrationsConfig: ctx.integrationsConfig,
        target: input.connection.target,
      }),
    ),
  );
  const webhookCallbackUrl =
    flow.requiresWebhookCallbackUrl === true
      ? await resolveProviderConfigurationWebhookCallbackUrl({
          connection: input.connection,
          controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
        })
      : undefined;

  try {
    await flow.complete({
      connection: {
        id: input.connection.id,
        status: input.connection.status,
        config: {
          ...input.parsedConfig,
          connection_method: input.methodId,
        },
      },
      connectionSecrets,
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      target: {
        familyId: input.connection.target.familyId,
        variantId: input.connection.target.variantId,
        enabled: input.connection.target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      ...(webhookCallbackUrl === undefined ? {} : { webhookCallbackUrl }),
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      error instanceof Error ? error.message : "Provider configuration setup failed.",
    );
  }
}
