import {
  type ControlPlaneDatabase,
  type IntegrationConnectionRedirectSession,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type {
  AnyIntegrationDefinition,
  IntegrationConnectionMethodId,
  IntegrationProviderAppSetupCompleteResult,
  IntegrationProviderAppSetupCompletionRedirect,
  IntegrationProviderAppSetupFlowCapability,
  IntegrationProviderAppSetupStatelessCallbackResolution,
  IntegrationProviderAppSetupStartResult,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { sql } from "drizzle-orm";
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
  completionRedirect: IntegrationProviderAppSetupCompletionRedirect;
  id: string;
  targetKey: string;
  routeSegment: string;
};

export type ProviderAppSetupStatelessErrorRedirectTarget = {
  targetKey: string;
};

type ConnectionWithTarget = Awaited<ReturnType<typeof resolveConnectionWithTargetOrThrow>>;

type ResolvedProviderAppSetupCompletionContext = {
  connection: ConnectionWithTarget;
  definition: AnyIntegrationDefinition;
  flow: IntegrationProviderAppSetupFlowCapability;
  redirectSession?: IntegrationConnectionRedirectSession;
  routeSegment: string;
};

type ResolvedProviderAppSetupCompletionContextWithResult =
  ResolvedProviderAppSetupCompletionContext & {
    setupResult: IntegrationProviderAppSetupCompleteResult;
  };

function hasResolvedProviderAppSetupResult(
  input: ResolvedProviderAppSetupCompletionContext,
): input is ResolvedProviderAppSetupCompletionContextWithResult {
  return "setupResult" in input;
}

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
  config: Record<string, unknown>;
  methodId: IntegrationConnectionMethodId;
  routeSegment: string;
}): void {
  const connectionMethod = input.config["connection_method"];
  if (connectionMethod === input.methodId) {
    return;
  }

  const receivedMethod =
    typeof connectionMethod === "string" && connectionMethod.length > 0
      ? connectionMethod
      : "missing";
  throw new BadRequestError(
    IntegrationConnectionsBadRequestCodes.PROVIDER_APP_SETUP_CONNECTION_METHOD_NOT_SUPPORTED,
    `Integration setup flow '${input.routeSegment}' requires connection method '${input.methodId}', received '${receivedMethod}'.`,
  );
}

function assertCallbackRouteKeyMatchesSetupFlow(input: {
  callbackRouteKey: string;
  flow: IntegrationProviderAppSetupFlowCapability;
  routeSegment: string;
}): void {
  const acceptedCallbackRouteKeys = [
    input.flow.callbackRouteKey,
    ...(input.flow.additionalCallbackRouteKeys ?? []),
  ];

  if (acceptedCallbackRouteKeys.includes(input.callbackRouteKey)) {
    return;
  }

  throw new BadRequestError(
    IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
    `Provider app setup callback route key '${input.callbackRouteKey}' does not match setup flow '${input.routeSegment}'.`,
  );
}

function getAcceptedSetupFlowCallbackRouteKeys(
  flow: IntegrationProviderAppSetupFlowCapability,
): readonly string[] {
  return [flow.callbackRouteKey, ...(flow.additionalCallbackRouteKeys ?? [])].filter(
    (routeKey): routeKey is string => routeKey !== undefined,
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

async function listStatelessProviderAppSetupResolutions(input: {
  callbackRouteKey: string;
  integrationRegistry: IntegrationRegistry;
  queryParams: URLSearchParams;
}): Promise<
  Array<{
    definition: AnyIntegrationDefinition;
    flow: IntegrationProviderAppSetupFlowCapability;
    resolution: IntegrationProviderAppSetupStatelessCallbackResolution;
  }>
> {
  const resolutions = [];

  for (const definition of input.integrationRegistry.listDefinitions()) {
    for (const flow of definition.providerAppSetup?.flows ?? []) {
      if (!getAcceptedSetupFlowCallbackRouteKeys(flow).includes(input.callbackRouteKey)) {
        continue;
      }

      const resolution = await flow.resolveStatelessCallback?.({
        callbackRouteKey: input.callbackRouteKey,
        query: input.queryParams,
      });
      if (resolution === undefined) {
        continue;
      }

      resolutions.push({
        definition,
        flow,
        resolution,
      });
    }
  }

  return resolutions;
}

async function resolveProviderAppSetupCompletionByState(input: {
  callbackRouteKey: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  state: string;
}): Promise<ResolvedProviderAppSetupCompletionContext> {
  const redirectSession = await resolveActiveRedirectSessionOrThrow({
    db: input.db,
    state: input.state,
    invalidStateCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
    alreadyUsedCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_ALREADY_USED,
    expiredCode: IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_EXPIRED,
  });
  const stateMetadata = resolveConnectionRedirectStateMetadata({ state: input.state });
  const connection = await resolveConnectionWithTargetOrThrow({
    db: input.db,
    organizationId: redirectSession.organizationId,
    connectionId: stateMetadata.connectionId,
  });

  if (connection.targetKey !== redirectSession.targetKey) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.REDIRECT_STATE_INVALID,
      "Redirect state does not match the target for this connection.",
    );
  }

  const definition = input.integrationRegistry.getDefinition({
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
  assertCallbackRouteKeyMatchesSetupFlow({
    callbackRouteKey: input.callbackRouteKey,
    flow,
    routeSegment: stateMetadata.routeSegment,
  });

  return {
    connection,
    definition,
    flow,
    redirectSession,
    routeSegment: stateMetadata.routeSegment,
  };
}

async function listProviderAppSetupStatelessConnectionCandidates(input: {
  db: ControlPlaneDatabase;
  definition: AnyIntegrationDefinition;
  flow: IntegrationProviderAppSetupFlowCapability;
  resolution: IntegrationProviderAppSetupStatelessCallbackResolution;
}): Promise<ConnectionWithTarget[]> {
  const candidateByConnectionId = new Map<string, ConnectionWithTarget>();
  const targets = await input.db.query.integrationTargets.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.familyId, input.definition.familyId),
        eq(table.variantId, input.definition.variantId),
        eq(table.enabled, true),
      ),
  });
  const targetKeys = targets.map((target) => target.targetKey);
  if (targetKeys.length === 0) {
    return [];
  }

  const addCandidate = (connection: ConnectionWithTarget) => {
    const config = connection.config;
    if (config === null || config["connection_method"] !== input.flow.methodId) {
      return;
    }

    candidateByConnectionId.set(connection.id, connection);
  };

  const installedConnections = await input.db.query.integrationConnections.findMany({
    where: (table, { and, eq, inArray, or }) => {
      const configExternalSubjectField = input.resolution.connectionConfigExternalSubjectField;
      const externalSubjectPredicate =
        configExternalSubjectField === undefined
          ? eq(table.externalSubjectId, input.resolution.externalSubjectId)
          : or(
              eq(table.externalSubjectId, input.resolution.externalSubjectId),
              sql`${table.config}->>${configExternalSubjectField} = ${input.resolution.externalSubjectId}`,
            );

      return and(inArray(table.targetKey, targetKeys), externalSubjectPredicate);
    },
    with: {
      target: true,
    },
  });
  for (const connection of installedConnections) {
    if (connection.target === null) {
      continue;
    }

    addCandidate({
      id: connection.id,
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      displayName: connection.displayName,
      status: connection.status,
      config: connection.config,
      target: connection.target,
    });
  }

  return [...candidateByConnectionId.values()];
}

async function executeProviderAppSetupCompletion(input: {
  callbackRouteKey: string;
  connection: ConnectionWithTarget;
  controlPlaneBaseUrl: string;
  db: ControlPlaneDatabase;
  definition: AnyIntegrationDefinition;
  flow: IntegrationProviderAppSetupFlowCapability;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  queryParams: URLSearchParams;
  routeSegment: string;
}): Promise<IntegrationProviderAppSetupCompleteResult> {
  if (input.flow.complete === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration setup flow '${input.routeSegment}' does not support setup completion.`,
    );
  }

  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: input.connection.id,
    config: input.connection.config,
  });
  const parsedConnectionConfig = UnknownRecordSchema.parse(connectionConfig);
  assertConnectionMethodMatchesSetupFlow({
    config: parsedConnectionConfig,
    methodId: input.flow.methodId,
    routeSegment: input.routeSegment,
  });
  const parsedTargetConfig = UnknownRecordSchema.parse(
    input.definition.targetConfigSchema.parse(input.connection.target.config),
  );
  const parsedTargetSecrets = StringRecordSchema.parse(
    input.definition.targetSecretSchema.parse(
      resolveIntegrationTargetSecrets({
        integrationsConfig: input.integrationsConfig,
        target: input.connection.target,
      }),
    ),
  );

  return await input.flow.complete({
    callbackRouteKey: input.callbackRouteKey,
    connection: {
      id: input.connection.id,
      status: input.connection.status,
      config: parsedConnectionConfig,
    },
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    query: input.queryParams,
    resolveConnectionSecret: (secretInput) =>
      resolveConnectionSecretValue({
        db: input.db,
        integrationRegistry: input.integrationRegistry,
        integrationsConfig: input.integrationsConfig,
        connectionId: input.connection.id,
        secretKind: secretInput.secretKind,
        slotKey: secretInput.slotKey,
      }),
    target: {
      familyId: input.connection.target.familyId,
      variantId: input.connection.target.variantId,
      enabled: input.connection.target.enabled,
      config: parsedTargetConfig,
      secrets: parsedTargetSecrets,
    },
  });
}

async function resolveProviderAppSetupCompletionWithoutState(input: {
  callbackRouteKey: string;
  controlPlaneBaseUrl: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  queryParams: URLSearchParams;
}): Promise<
  ResolvedProviderAppSetupCompletionContext & {
    setupResult: IntegrationProviderAppSetupCompleteResult;
  }
> {
  const resolutions = await listStatelessProviderAppSetupResolutions({
    callbackRouteKey: input.callbackRouteKey,
    integrationRegistry: input.integrationRegistry,
    queryParams: input.queryParams,
  });
  if (resolutions.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
      "Provider app setup callback query must include `state`.",
    );
  }

  const candidates = (
    await Promise.all(
      resolutions.map(async (resolution) => {
        const candidateConnections = await listProviderAppSetupStatelessConnectionCandidates({
          db: input.db,
          definition: resolution.definition,
          flow: resolution.flow,
          resolution: resolution.resolution,
        });

        return candidateConnections.map((candidate) => ({
          connection: candidate,
          definition: resolution.definition,
          flow: resolution.flow,
          routeSegment: resolution.resolution.routeSegment,
        }));
      }),
    )
  ).flat();
  const verifiedCandidates = [];

  for (const candidate of candidates) {
    try {
      const setupResult = await executeProviderAppSetupCompletion({
        callbackRouteKey: input.callbackRouteKey,
        connection: candidate.connection,
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        db: input.db,
        definition: candidate.definition,
        flow: candidate.flow,
        integrationRegistry: input.integrationRegistry,
        integrationsConfig: input.integrationsConfig,
        queryParams: input.queryParams,
        routeSegment: candidate.routeSegment,
      });
      verifiedCandidates.push({
        ...candidate,
        setupResult,
      });
    } catch {
      continue;
    }
  }

  if (verifiedCandidates.length === 0) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
      "Provider app setup callback could not be matched to a verified connection.",
    );
  }

  if (verifiedCandidates.length > 1) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
      "Provider app setup callback matched multiple verified connections.",
    );
  }

  const verifiedCandidate = verifiedCandidates[0];
  if (verifiedCandidate === undefined) {
    throw new Error("Verified provider app setup candidate disappeared.");
  }

  return {
    connection: verifiedCandidate.connection,
    definition: verifiedCandidate.definition,
    flow: verifiedCandidate.flow,
    routeSegment: verifiedCandidate.routeSegment,
    setupResult: verifiedCandidate.setupResult,
  };
}

export async function resolveProviderAppSetupStatelessErrorRedirectTarget(input: {
  callbackRouteKey: string;
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  queryParams: URLSearchParams;
}): Promise<ProviderAppSetupStatelessErrorRedirectTarget | null> {
  const resolutions = await listStatelessProviderAppSetupResolutions({
    callbackRouteKey: input.callbackRouteKey,
    integrationRegistry: input.integrationRegistry,
    queryParams: input.queryParams,
  });
  if (resolutions.length === 0) {
    return null;
  }

  const targetKeyByTargetKey = new Map<string, string>();
  for (const resolution of resolutions) {
    const targets = await input.db.query.integrationTargets.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.familyId, resolution.definition.familyId),
          eq(table.variantId, resolution.definition.variantId),
          eq(table.enabled, true),
        ),
    });

    for (const target of targets) {
      targetKeyByTargetKey.set(target.targetKey, target.targetKey);
    }
  }

  if (targetKeyByTargetKey.size !== 1) {
    return null;
  }

  const targetKey = [...targetKeyByTargetKey.values()][0];
  if (targetKey === undefined) {
    throw new Error("Provider app setup stateless redirect target disappeared.");
  }

  return { targetKey };
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
        IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_START_INPUT,
        `Integration connection '${connection.id}' is missing required setup credentials.`,
      );
    }

    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_START_INPUT,
      error instanceof Error ? error.message : "Provider app setup start failed.",
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: flow.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_START_INPUT,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: startedSetup.secrets ?? {},
    invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_START_INPUT,
  });

  await persistRedirectSessionOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    targetKey: connection.targetKey,
    state: redirectState,
    expiresAt: createRedirectSessionExpiryTimestamp(),
    failureMessage: "Failed to persist provider app setup redirect session state.",
  });

  if (
    parsedSecrets.length > 0 ||
    startedSetup.connection !== undefined ||
    startedSetup.webhookSource !== undefined
  ) {
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
      ...(startedSetup.webhookSource === undefined
        ? {}
        : { webhookSourceUpdate: startedSetup.webhookSource }),
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
    callbackRouteKey: string;
    query: Record<string, string>;
  },
): Promise<CompletedProviderAppSetup> {
  const queryParams = createRedirectQueryParams(input.query);
  const state = queryParams.get("state");
  const resolvedCompletion =
    state === null || state.length === 0
      ? await resolveProviderAppSetupCompletionWithoutState({
          callbackRouteKey: input.callbackRouteKey,
          controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
          queryParams,
        })
      : await resolveProviderAppSetupCompletionByState({
          callbackRouteKey: input.callbackRouteKey,
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          state,
        });
  const { connection, definition, flow, redirectSession, routeSegment } = resolvedCompletion;

  let setupResult: IntegrationProviderAppSetupCompleteResult | undefined =
    hasResolvedProviderAppSetupResult(resolvedCompletion)
      ? resolvedCompletion.setupResult
      : undefined;
  try {
    setupResult ??= await executeProviderAppSetupCompletion({
      callbackRouteKey: input.callbackRouteKey,
      connection,
      controlPlaneBaseUrl: ctx.controlPlaneBaseUrl,
      db: ctx.db,
      definition,
      flow,
      integrationRegistry: ctx.integrationRegistry,
      integrationsConfig: ctx.integrationsConfig,
      queryParams,
      routeSegment,
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
        IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
        `Integration connection '${connection.id}' is missing required setup credentials.`,
      );
    }

    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
      error instanceof Error ? error.message : "Provider app setup completion failed.",
    );
  }

  const completionRedirect = setupResult.completionRedirect;
  if (completionRedirect === undefined) {
    throw new Error(
      `Integration setup flow '${routeSegment}' completed without a redirect destination.`,
    );
  }

  const formMethod = resolveFormConnectionMethodOrThrow({
    targetKey: connection.targetKey,
    methodId: flow.methodId,
    connectionMethods: definition.connectionMethods,
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
  });
  const parsedSecrets = parseUpdateFormSecretsOrThrow({
    method: formMethod,
    secrets: setupResult.secrets ?? {},
    invalidInputCode:
      IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT,
  });
  const completedConnection = await persistProviderAppSetupResult({
    db: ctx.db,
    integrationsConfig: ctx.integrationsConfig,
    organizationId: redirectSession?.organizationId ?? connection.organizationId,
    connection,
    definition,
    parsedSecrets,
    ...(setupResult.connection === undefined ? {} : { connectionUpdate: setupResult.connection }),
    ...(setupResult.webhookSource === undefined
      ? {}
      : { webhookSourceUpdate: setupResult.webhookSource }),
    ...(redirectSession === undefined ? {} : { redirectSession }),
  });

  return {
    ...completedConnection,
    completionRedirect,
    routeSegment,
  };
}
