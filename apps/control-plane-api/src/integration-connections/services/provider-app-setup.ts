import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type {
  IntegrationConnectionMethodId,
  IntegrationProviderAppSetupFlowCapability,
  IntegrationProviderAppSetupStartResult,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "../../internal/integration-credentials/services/errors.js";
import { resolveIntegrationCredential } from "../../internal/integration-credentials/services/resolve-credential.js";
import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import {
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
} from "./form-connection-methods.js";
import {
  createRedirectQueryParams,
  createRedirectSessionExpiryTimestamp,
  createRedirectState,
  encodeConnectionSetupRedirectStateMetadata,
  persistRedirectSessionOrThrow,
  resolveActiveRedirectSessionOrThrow,
  resolveConnectionRedirectStateMetadata,
} from "./redirect-flow.js";
import { persistProviderAppSetupResult } from "./setup-result-persistence.js";
import {
  ensureImplicitConnectionWebhookSource,
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveWebhookSourceCapabilityOrThrow,
} from "./webhook-sources.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());

type CompletedProviderAppSetup = {
  id: string;
  targetKey: string;
  routeSegment: string;
};

type ProviderAppSetupStartInvalidInputCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;

type ProviderAppSetupCompleteInvalidInputCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_INSTALLATION_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;

function resolveSetupFlowOrThrow(input: {
  routeSegment: string;
  flows: ReadonlyArray<IntegrationProviderAppSetupFlowCapability>;
}): IntegrationProviderAppSetupFlowCapability {
  const flow = input.flows.find((entry) => entry.routeSegment === input.routeSegment);
  if (flow === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration setup flow '${input.routeSegment}' is not supported.`,
    );
  }

  return flow;
}

function assertConnectionMethodMatchesSetupFlow(input: {
  connectionId: string;
  config: Record<string, unknown>;
  methodId: IntegrationConnectionMethodId;
  routeSegment: string;
}): void {
  const connectionMethod = input.config["connection_method"];
  if (connectionMethod === input.methodId) {
    return;
  }

  if (input.methodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration connection '${input.connectionId}' does not use GitHub App installation auth.`,
    );
  }

  const receivedMethod =
    typeof connectionMethod === "string" && connectionMethod.length > 0
      ? connectionMethod
      : "missing";
  throw new BadRequestError(
    IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
    `Integration setup flow '${input.routeSegment}' requires connection method '${input.methodId}', received '${receivedMethod}'.`,
  );
}

async function resolveConnectionSecretValue(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  connectionId: string;
  secretKind: string;
  slotKey: string;
}): Promise<string> {
  const credential = await resolveIntegrationCredential(
    {
      db: input.db,
      integrationRegistry: input.integrationRegistry,
      integrationsConfig: input.integrationsConfig,
    },
    {
      connectionId: input.connectionId,
      secretType: input.secretKind,
      slotKey: input.slotKey,
    },
  );

  if (credential.kind !== "value") {
    throw new Error(`Connection credential '${input.slotKey}' must resolve to a string value.`);
  }

  return credential.value;
}

async function resolveWebhookCallbackUrl(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  controlPlaneBaseUrl: string;
  connection: Awaited<ReturnType<typeof resolveConnectionWithTargetOrThrow>>;
}): Promise<string | undefined> {
  const {
    webhookSourceCapability,
    parsedTargetConfig: parsedWebhookTargetConfig,
    parsedTargetSecrets,
  } = resolveWebhookSourceCapabilityOrThrow({
    integrationRegistry: input.integrationRegistry,
    integrationsConfig: input.integrationsConfig,
    target: input.connection.target,
  });
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: input.connection.id,
    config: input.connection.config,
  });
  const webhookSource = await ensureImplicitConnectionWebhookSource({
    db: input.db,
    organizationId: input.connection.organizationId,
    connectionId: input.connection.id,
    targetKey: input.connection.targetKey,
  });
  const webhookSourceDescriptor = await webhookSourceCapability.describeSource({
    organizationId: input.connection.organizationId,
    targetKey: input.connection.targetKey,
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    target: {
      familyId: input.connection.target.familyId,
      variantId: input.connection.target.variantId,
      enabled: input.connection.target.enabled,
      config: parsedWebhookTargetConfig,
      secrets: parsedTargetSecrets,
    },
    connection: {
      id: input.connection.id,
      status: input.connection.status,
      config: connectionConfig,
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

  return webhookSourceDescriptor.callbackUrl;
}

export async function startProviderAppSetup(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    organizationId: string;
    connectionId: string;
    routeSegment: string;
    body: Record<string, unknown>;
    invalidInputCode: ProviderAppSetupStartInvalidInputCode;
  },
): Promise<IntegrationProviderAppSetupStartResult> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition?.providerAppSetup === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration target '${connection.targetKey}' does not support provider app setup.`,
    );
  }

  const flow = resolveSetupFlowOrThrow({
    flows: definition.providerAppSetup.flows,
    routeSegment: input.routeSegment,
  });

  if (flow.start === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration setup flow '${input.routeSegment}' does not support setup start.`,
    );
  }

  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  const parsedConnectionConfig = UnknownRecordSchema.parse(connectionConfig);
  assertConnectionMethodMatchesSetupFlow({
    connectionId: connection.id,
    config: parsedConnectionConfig,
    methodId: flow.methodId,
    routeSegment: input.routeSegment,
  });
  const parsedTargetConfig = UnknownRecordSchema.parse(
    definition.targetConfigSchema.parse(connection.target.config),
  );
  const parsedTargetSecrets = StringRecordSchema.parse(
    definition.targetSecretSchema.parse(
      resolveIntegrationTargetSecrets({
        integrationsConfig: ctx.integrationsConfig,
        target: connection.target,
      }),
    ),
  );
  const redirectState = encodeConnectionSetupRedirectStateMetadata({
    state: createRedirectState(),
    connectionId: connection.id,
    routeSegment: input.routeSegment,
  });
  const webhookCallbackUrl =
    flow.requiresWebhookCallbackUrl === true
      ? await resolveWebhookCallbackUrl({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
          controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
          connection,
        })
      : undefined;

  let startedSetup;
  try {
    startedSetup = await flow.start({
      body: input.body,
      connection: {
        id: connection.id,
        status: connection.status,
        config: parsedConnectionConfig,
      },
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      redirectState,
      resolveConnectionSecret: (secretInput) =>
        resolveConnectionSecretValue({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
          connectionId: connection.id,
          secretKind: secretInput.secretKind,
          slotKey: secretInput.slotKey,
        }),
      target: {
        familyId: connection.target.familyId,
        variantId: connection.target.variantId,
        enabled: connection.target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      ...(webhookCallbackUrl === undefined ? {} : { webhookCallbackUrl }),
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    if (
      error instanceof InternalIntegrationCredentialsError &&
      error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
    ) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration connection '${connection.id}' is missing required setup credentials.`,
      );
    }

    throw new BadRequestError(
      input.invalidInputCode,
      error instanceof Error ? error.message : "Provider app setup start failed.",
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: flow.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: input.invalidInputCode,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: startedSetup.secrets ?? {},
    invalidInputCode: input.invalidInputCode,
  });

  await persistRedirectSessionOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state: redirectState,
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist provider app setup redirect session state.",
  });

  if (parsedSecrets.length > 0 || startedSetup.connection !== undefined) {
    await persistProviderAppSetupResult({
      db: ctx.db,
      integrationsConfig: ctx.integrationsConfig,
      organizationId: input.organizationId,
      connection,
      definition,
      parsedSecrets,
      ...(startedSetup.connection === undefined
        ? {}
        : { connectionUpdate: startedSetup.connection }),
    });
  }

  return startedSetup.start;
}

export async function completeProviderAppSetup(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    controlPlaneBaseUrl: string;
  },
  input: {
    query: Record<string, string>;
    invalidInputCode: ProviderAppSetupCompleteInvalidInputCode;
  },
): Promise<CompletedProviderAppSetup> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = queryParams.get("state");
  if (state === null || state.length === 0) {
    throw new BadRequestError(
      input.invalidInputCode,
      "Provider app setup callback query must include `state`.",
    );
  }

  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db: ctx.db,
    state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });
  const stateMetadata = resolveConnectionRedirectStateMetadata({ state });
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: redirectSession.organizationId,
    connectionId: stateMetadata.connectionId,
  });

  if (connection.targetKey !== redirectSession.targetKey) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state does not match the target for this connection.",
    );
  }

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });
  if (definition?.providerAppSetup === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration target '${connection.targetKey}' does not support provider app setup.`,
    );
  }

  const flow = resolveSetupFlowOrThrow({
    flows: definition.providerAppSetup.flows,
    routeSegment: stateMetadata.routeSegment,
  });
  if (flow.complete === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration setup flow '${stateMetadata.routeSegment}' does not support setup completion.`,
    );
  }

  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  const parsedConnectionConfig = UnknownRecordSchema.parse(connectionConfig);
  assertConnectionMethodMatchesSetupFlow({
    connectionId: connection.id,
    config: parsedConnectionConfig,
    methodId: flow.methodId,
    routeSegment: stateMetadata.routeSegment,
  });
  const parsedTargetConfig = UnknownRecordSchema.parse(
    definition.targetConfigSchema.parse(connection.target.config),
  );
  const parsedTargetSecrets = StringRecordSchema.parse(
    definition.targetSecretSchema.parse(
      resolveIntegrationTargetSecrets({
        integrationsConfig: ctx.integrationsConfig,
        target: connection.target,
      }),
    ),
  );

  let setupResult;
  try {
    setupResult = await flow.complete({
      connection: {
        id: connection.id,
        status: connection.status,
        config: parsedConnectionConfig,
      },
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      query: queryParams,
      resolveConnectionSecret: (secretInput) =>
        resolveConnectionSecretValue({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
          connectionId: connection.id,
          secretKind: secretInput.secretKind,
          slotKey: secretInput.slotKey,
        }),
      target: {
        familyId: connection.target.familyId,
        variantId: connection.target.variantId,
        enabled: connection.target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    if (
      error instanceof InternalIntegrationCredentialsError &&
      error.code === InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND
    ) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration connection '${connection.id}' is missing required setup credentials.`,
      );
    }

    throw new BadRequestError(
      input.invalidInputCode,
      error instanceof Error ? error.message : "Provider app setup completion failed.",
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: flow.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: input.invalidInputCode,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: setupResult.secrets ?? {},
    invalidInputCode: input.invalidInputCode,
  });
  const completedConnection = await persistProviderAppSetupResult({
    db: ctx.db,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: redirectSession.organizationId,
    connection,
    definition,
    parsedSecrets,
    ...(setupResult.connection === undefined ? {} : { connectionUpdate: setupResult.connection }),
    redirectSession,
  });

  return {
    ...completedConnection,
    routeSegment: stateMetadata.routeSegment,
  };
}
