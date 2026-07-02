import {
  type IntegrationConnection,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { BadRequestError, ForbiddenError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  resolveIntegrationForm,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import type {
  AnyIntegrationDefinition,
  IntegrationConnectionMethodDefinition,
  IntegrationFormContext,
} from "@mistle/integrations-core";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { prepareDesignerRuntimeProviderMcpInstall } from "../../designer/services/designer-runtime-provider-mcp.js";
import { INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH } from "../../integration-connections/constants.js";
import { buildIntegrationConnectionResponse } from "../../integration-connections/services/build-integration-connection-response.js";
import { listConfiguredSecretNamesByConnectionId } from "../../integration-connections/services/list-configured-secret-names-by-connection-id.js";
import { listIntegrationConnectionResources } from "../../integration-connections/services/list-integration-connection-resources.js";
import { listIntegrationConnections } from "../../integration-connections/services/list-integration-connections.js";
import { requestIntegrationConnectionResourceRefresh } from "../../integration-connections/services/refresh-integration-connection-resources.js";
import { startDeviceAuthorizationConnection } from "../../integration-connections/services/start-device-authorization-connection.js";
import { startOAuth2AuthorizationCodeConnection } from "../../integration-connections/services/start-oauth2-authorization-code-connection.js";
import { listIntegrationWebhookSources } from "../../integration-connections/services/webhook-sources.js";
import { listIntegrationTargets } from "../../integration-targets/services/list-integration-targets.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpIntegrationConnectionFormSetupPrepareInputSchema,
  mcpIntegrationConnectionIdParamsSchema,
  mcpIntegrationConnectionDeviceAuthorizationStartInputSchema,
  mcpDesignerRuntimeProviderMcpInstallPrepareInputSchema,
  mcpIntegrationConnectionOAuthStartInputSchema,
  mcpIntegrationConnectionResourcesListInputSchema,
  mcpIntegrationConnectionResourcesRefreshInputSchema,
  mcpIntegrationSetupStatusGetInputSchema,
  mcpListIntegrationConnectionsInputSchema,
  mcpListIntegrationTargetsInputSchema,
} from "../tool-schemas.js";
import { requireMcpToolPermission, structuredResult } from "./shared.js";

const ReadOnlyToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const MutatingToolAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const UnknownRecordSchema = z.record(z.string(), z.unknown());

type FormConnectionMethod = Extract<IntegrationConnectionMethodDefinition, { kind: "form" }>;
type RedirectConnectionMethod = Extract<
  IntegrationConnectionMethodDefinition,
  { kind: "redirect" }
>;

type PersistedIntegrationTarget = {
  targetKey: string;
  familyId: string;
  variantId: string;
  config: unknown;
};

type PersistedIntegrationConnection = Pick<
  IntegrationConnection,
  | "id"
  | "organizationId"
  | "targetKey"
  | "displayName"
  | "status"
  | "externalSubjectId"
  | "config"
  | "targetSnapshotConfig"
  | "createdAt"
  | "updatedAt"
> & {
  target: {
    familyId: string;
    variantId: string;
  } | null;
};

export function registerIntegrationTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "integration_targets_list",
    {
      title: "List integration targets",
      description:
        "List enabled Mistle integration targets and their setup capabilities. This reports connectable provider targets, not the current organization's existing connections.",
      inputSchema: mcpListIntegrationTargetsInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List integration targets",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );

      return structuredResult(
        await listIntegrationTargets(
          { db: context.db },
          {
            ...(input.after === undefined ? {} : { after: input.after }),
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          },
        ),
      );
    },
  );

  server.registerTool(
    "integration_connections_list",
    {
      title: "List integration connections",
      description:
        "List integration connections in the current Mistle organization, including non-secret setup state such as configured secret field names.",
      inputSchema: mcpListIntegrationConnectionsInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List integration connections",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );

      return structuredResult(
        await listIntegrationConnectionsForMcp(context, {
          ...(input.after === undefined ? {} : { after: input.after }),
          ...(input.before === undefined ? {} : { before: input.before }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.providerFamilyId === undefined
            ? {}
            : { providerFamilyId: input.providerFamilyId }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.targetKey === undefined ? {} : { targetKey: input.targetKey }),
        }),
      );
    },
  );

  server.registerTool(
    "integration_connection_get",
    {
      title: "Get integration connection",
      description:
        "Inspect one integration connection in the current Mistle organization, including non-secret setup state. Secret values are never returned.",
      inputSchema: mcpIntegrationConnectionIdParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get integration connection",
      },
    },
    async ({ connectionId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );

      return structuredResult(await getIntegrationConnectionForMcp(context, { connectionId }));
    },
  );

  server.registerTool(
    "designer_runtime_provider_mcp_install_prepare",
    {
      title: "Prepare Designer runtime provider MCP install",
      description:
        "Preview and validate the Designer-only runtime action for installing supported remote provider MCP tools for an existing organization integration connection. To perform the install, call dashboard_control.install_runtime_mcp_servers with the same connectionId and toolIds; the dashboard prepares the install through control plane before mutating the runtime.",
      inputSchema: mcpDesignerRuntimeProviderMcpInstallPrepareInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Prepare Designer runtime provider MCP install",
      },
    },
    async ({ connectionId, toolIds }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );
      if (
        context.organizationActor.kind !== "mcp_capability" ||
        context.organizationActor.capability.kind !== "designer"
      ) {
        throw new ForbiddenError(
          "FORBIDDEN",
          "Designer runtime provider MCP installation requires a Designer MCP capability.",
        );
      }

      return structuredResult(
        await prepareDesignerRuntimeProviderMcpInstall(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
            integrationsConfig: context.integrationsConfig,
          },
          {
            organizationId: context.organizationActor.organizationId,
            designerSessionId: context.organizationActor.capability.designerSessionId,
            sandboxInstanceId: context.organizationActor.capability.sandboxInstanceId,
            connectionId,
            toolIds,
          },
        ),
      );
    },
  );

  server.registerTool(
    "integration_setup_status_get",
    {
      title: "Get integration setup status",
      description:
        "Get compact setup status for a target or provider family in the current Mistle organization. Use after resolving a provider name from the Designer integration catalog to decide whether an App is already connected or an App setup step is needed.",
      inputSchema: mcpIntegrationSetupStatusGetInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get integration setup status",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );

      return structuredResult(await getIntegrationSetupStatusForMcp(context, input));
    },
  );

  server.registerTool(
    "integration_connection_form_setup_prepare",
    {
      title: "Prepare form integration setup",
      description:
        "Prepare a user-action setup descriptor for a form/API-key integration connection. The descriptor includes non-secret form schema, secret field metadata, and direct dashboard/API submission metadata, but it never accepts or returns secret values.",
      inputSchema: mcpIntegrationConnectionFormSetupPrepareInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Prepare form integration setup",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        input.connectionId === undefined
          ? OrganizationPermissions.INTEGRATION_CONNECTION_CREATE
          : OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
      );

      return structuredResult(await prepareFormIntegrationSetup(context, input));
    },
  );

  server.registerTool(
    "integration_connection_resources_list",
    {
      title: "List integration connection resources",
      description:
        "List provider resources synced for an integration connection. Use this after connection setup completion when selecting resources for profile bindings or trigger setup.",
      inputSchema: mcpIntegrationConnectionResourcesListInputSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List integration connection resources",
      },
    },
    async (input) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
      );

      return structuredResult(
        await listIntegrationConnectionResources(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
          },
          {
            organizationId: context.organizationActor.organizationId,
            connectionId: input.connectionId,
            kind: input.kind,
            ...(input.after === undefined ? {} : { after: input.after }),
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            ...(input.search === undefined ? {} : { search: input.search }),
          },
        ),
      );
    },
  );

  server.registerTool(
    "integration_connection_oauth_start",
    {
      title: "Start OAuth integration setup",
      description:
        "Create safe pending OAuth setup state and return a user-action descriptor containing the provider authorization URL. This does not bypass user consent or expose provider tokens.",
      inputSchema: mcpIntegrationConnectionOAuthStartInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        openWorldHint: true,
        title: "Start OAuth integration setup",
      },
    },
    async ({ displayName, targetKey }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
      );

      const prepared = await prepareOAuthStartSetupIfConfigRequired(context, {
        targetKey,
        ...(displayName === undefined ? {} : { displayName }),
      });
      if (prepared !== null) {
        return structuredResult(prepared);
      }

      const started = await startOAuth2AuthorizationCodeConnection(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          integrationsConfig: context.integrationsConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          targetKey,
          controlPlaneBaseUrl: context.controlPlaneBaseUrl,
          ...(displayName === undefined ? {} : { displayName }),
        },
      );

      return structuredResult({
        kind: "user_action_integration_setup_descriptor",
        actionKind: "oauth_authorization_url",
        targetKey,
        ...(displayName === undefined ? {} : { suggestedDisplayName: displayName }),
        authorizationUrl: started.authorizationUrl,
      });
    },
  );

  server.registerTool(
    "integration_connection_device_authorization_start",
    {
      title: "Start device authorization integration setup",
      description:
        "Create safe pending device authorization setup state and return a user-action descriptor containing the verification URL and user code. This does not bypass user consent or expose provider tokens.",
      inputSchema: mcpIntegrationConnectionDeviceAuthorizationStartInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        idempotentHint: false,
        openWorldHint: true,
        title: "Start device authorization integration setup",
      },
    },
    async ({ displayName, methodId, targetKey }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
      );

      const started = await startDeviceAuthorizationConnection(
        {
          db: context.db,
          integrationRegistry: context.integrationRegistry,
          integrationsConfig: context.integrationsConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          targetKey,
          methodId,
          ...(displayName === undefined ? {} : { displayName }),
        },
      );

      return structuredResult({
        kind: "user_action_integration_setup_descriptor",
        actionKind: "device_authorization",
        targetKey,
        methodId,
        ...(displayName === undefined ? {} : { suggestedDisplayName: displayName }),
        attempt: started,
      });
    },
  );

  server.registerTool(
    "integration_connection_resources_refresh",
    {
      title: "Refresh integration connection resources",
      description:
        "Request a provider resource refresh for an existing integration connection and resource kind. This does not accept secret values.",
      inputSchema: mcpIntegrationConnectionResourcesRefreshInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Refresh integration connection resources",
      },
    },
    async ({ connectionId, kind }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
      );

      return structuredResult(
        await requestIntegrationConnectionResourceRefresh(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
            openWorkflow: context.openWorkflow,
          },
          {
            organizationId: context.organizationActor.organizationId,
            connectionId,
            kind,
          },
        ),
      );
    },
  );

  server.registerTool(
    "integration_webhook_sources_list",
    {
      title: "List integration webhook sources",
      description:
        "List webhook sources for an existing integration connection. Secret values are never returned.",
      inputSchema: mcpIntegrationConnectionIdParamsSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List integration webhook sources",
      },
    },
    async ({ connectionId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_READ,
      );

      return structuredResult({
        items: await listIntegrationWebhookSources(
          {
            db: context.db,
            integrationRegistry: context.integrationRegistry,
            integrationsConfig: context.integrationsConfig,
            controlPlaneBaseUrl: context.controlPlaneBaseUrl,
          },
          {
            organizationId: context.organizationActor.organizationId,
            connectionId,
          },
        ),
      });
    },
  );
}

async function prepareOAuthStartSetupIfConfigRequired(
  context: MistleMcpServerContext,
  input: {
    targetKey: string;
    displayName?: string | undefined;
  },
): Promise<Record<string, unknown> | null> {
  const target = await getTargetOrThrow(context, { targetKey: input.targetKey });
  const definition = getDefinitionOrThrow({
    integrationRegistry: context.integrationRegistry,
    target,
  });
  const method = definition.connectionMethods.find(
    (entry): entry is RedirectConnectionMethod =>
      entry.kind === "redirect" &&
      entry.id === IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
  );

  if (method?.startConfigSchema === undefined) {
    return null;
  }

  const formContext = createFormContext({
    connection: undefined,
    currentValue: {},
    definition,
    target,
  });
  const resolvedForm = resolveIntegrationForm({
    schema: method.startConfigSchema,
    form: method.startConfigForm,
    context: formContext,
  });

  return {
    kind: "user_action_integration_setup_descriptor",
    actionKind: "oauth_start_form",
    targetKey: target.targetKey,
    methodId: method.id,
    methodLabel: method.label,
    ...(input.displayName === undefined ? {} : { suggestedDisplayName: input.displayName }),
    directSubmission: {
      method: "POST",
      path: `${INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/${encodeURIComponent(
        target.targetKey,
      )}/oauth2-authorization-code/start`,
    },
    form: {
      schema: resolvedForm.schema,
      ...(resolvedForm.uiSchema === undefined ? {} : { uiSchema: resolvedForm.uiSchema }),
    },
  };
}

async function getIntegrationConnectionForMcp(
  context: MistleMcpServerContext,
  input: { connectionId: string },
): Promise<Record<string, unknown>> {
  const connection = await getConnectionOrThrow(context, input);
  const configuredSecretNamesByConnectionId = await listConfiguredSecretNamesByConnectionId({
    connections: [connection],
    db: context.db,
    integrationRegistry: context.integrationRegistry,
  });
  const definition =
    connection.target === null
      ? undefined
      : context.integrationRegistry.getDefinition({
          familyId: connection.target.familyId,
          variantId: connection.target.variantId,
        });

  return sanitizeMcpIntegrationConnectionResponse({
    response: buildIntegrationConnectionResponse({
      connection,
      ...(definition === undefined ? {} : { connectionMethods: definition.connectionMethods }),
      configuredSecretNames: configuredSecretNamesByConnectionId.get(connection.id),
    }),
    definition,
  });
}

type IntegrationConnectionsListResult = Awaited<ReturnType<typeof listIntegrationConnections>>;

async function listIntegrationConnectionsForMcp(
  context: MistleMcpServerContext,
  input: {
    limit?: number;
    after?: string | undefined;
    before?: string | undefined;
    providerFamilyId?: string | undefined;
    status?: IntegrationConnection["status"] | undefined;
    targetKey?: string | undefined;
  },
): Promise<IntegrationConnectionsListResult> {
  const resolvedTargetKeys =
    input.providerFamilyId === undefined
      ? undefined
      : await listEnabledTargetKeysByProviderFamily(context, {
          providerFamilyId: input.providerFamilyId,
        });

  const result = await listIntegrationConnections(
    {
      db: context.db,
      integrationRegistry: context.integrationRegistry,
    },
    {
      organizationId: context.organizationActor.organizationId,
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.targetKey === undefined ? {} : { targetKey: input.targetKey }),
      ...(resolvedTargetKeys === undefined ? {} : { targetKeys: resolvedTargetKeys }),
    },
  );
  const targetKeys = [...new Set(result.items.map((connection) => connection.targetKey))];
  const targets =
    targetKeys.length === 0
      ? []
      : await context.db.query.integrationTargets.findMany({
          where: (table, { inArray }) => inArray(table.targetKey, targetKeys),
        });
  const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));

  return {
    ...result,
    items: result.items.map((connection) => {
      const target = targetsByKey.get(connection.targetKey);
      const definition =
        target === undefined
          ? undefined
          : context.integrationRegistry.getDefinition({
              familyId: target.familyId,
              variantId: target.variantId,
            });

      return sanitizeMcpIntegrationConnectionResponse({
        response: connection,
        definition,
      });
    }),
  };
}

async function getIntegrationSetupStatusForMcp(
  context: MistleMcpServerContext,
  input: {
    providerFamilyId?: string | undefined;
    targetKey?: string | undefined;
  },
): Promise<Record<string, unknown>> {
  const targets = await listSetupStatusTargets(context, input);
  const targetKeys = targets.map((target) => target.targetKey);
  const connections =
    targetKeys.length === 0
      ? []
      : await context.db.query.integrationConnections.findMany({
          where: (table, { and, eq, inArray }) =>
            and(
              eq(table.organizationId, context.organizationActor.organizationId),
              inArray(table.targetKey, targetKeys),
            ),
          orderBy: (table, { asc }) => [asc(table.targetKey), asc(table.id)],
          with: {
            target: {
              columns: {
                familyId: true,
                variantId: true,
              },
            },
          },
        });
  const configuredSecretNamesByConnectionId = await listConfiguredSecretNamesByConnectionId({
    connections,
    db: context.db,
    integrationRegistry: context.integrationRegistry,
  });
  const connectionsByTargetKey = new Map<string, typeof connections>();
  for (const connection of connections) {
    const targetConnections = connectionsByTargetKey.get(connection.targetKey) ?? [];
    targetConnections.push(connection);
    connectionsByTargetKey.set(connection.targetKey, targetConnections);
  }

  return {
    items: targets.map((target) => {
      const definition = getDefinitionOrThrow({
        integrationRegistry: context.integrationRegistry,
        target,
      });
      const targetConnections = connectionsByTargetKey.get(target.targetKey) ?? [];
      const activeConnectionCount = targetConnections.filter(
        (connection) => connection.status === IntegrationConnectionStatuses.ACTIVE,
      ).length;

      return {
        target: {
          targetKey: target.targetKey,
          providerFamilyId: target.familyId,
          variantId: target.variantId,
          displayName: definition.displayName,
        },
        setup: {
          setupSupported: definition.connectionMethods.length > 0,
          requiresSetup: activeConnectionCount === 0,
          availableMethods: definition.connectionMethods.map((method) => ({
            methodId: method.id,
            kind: method.kind,
            label: method.label,
            ...(method.kind === "form"
              ? { secretFieldNames: method.secretFields.map((field) => field.name) }
              : {}),
          })),
        },
        connections: targetConnections.map((connection) => {
          const config = readConnectionConfig(connection);
          const connectionMethod = config["connection_method"];

          return {
            connectionId: connection.id,
            displayName: connection.displayName,
            status: connection.status,
            setupComplete: connection.status === IntegrationConnectionStatuses.ACTIVE,
            ...(typeof connectionMethod === "string" && connectionMethod.length > 0
              ? { methodId: connectionMethod }
              : {}),
            configuredSecretNames: configuredSecretNamesByConnectionId.get(connection.id) ?? [],
            createdAt: normalizeDateString(connection.createdAt),
            updatedAt: normalizeDateString(connection.updatedAt),
          };
        }),
      };
    }),
  };
}

async function listSetupStatusTargets(
  context: MistleMcpServerContext,
  input: {
    providerFamilyId?: string | undefined;
    targetKey?: string | undefined;
  },
): Promise<PersistedIntegrationTarget[]> {
  if (input.targetKey === undefined && input.providerFamilyId === undefined) {
    throw new BadRequestError(
      "INVALID_INTEGRATION_SETUP_STATUS_INPUT",
      "Either `targetKey` or `providerFamilyId` must be provided.",
    );
  }

  const targets =
    input.targetKey !== undefined
      ? [
          await getTargetOrThrow(context, {
            targetKey: input.targetKey,
          }),
        ]
      : await context.db.query.integrationTargets.findMany({
          where: (table, { and, eq }) =>
            and(eq(table.enabled, true), eq(table.familyId, input.providerFamilyId ?? "")),
          orderBy: (table, { asc }) => [asc(table.targetKey)],
        });

  if (input.providerFamilyId !== undefined) {
    const mismatchedTarget = targets.find((target) => target.familyId !== input.providerFamilyId);
    if (mismatchedTarget !== undefined) {
      throw new BadRequestError(
        "INVALID_INTEGRATION_SETUP_STATUS_INPUT",
        `Integration target '${mismatchedTarget.targetKey}' does not belong to provider family '${input.providerFamilyId}'.`,
      );
    }
  }

  if (targets.length === 0) {
    throw new NotFoundError(
      "TARGET_NOT_FOUND",
      `No enabled integration target was found for provider family '${input.providerFamilyId ?? ""}'.`,
    );
  }

  return targets;
}

async function listEnabledTargetKeysByProviderFamily(
  context: MistleMcpServerContext,
  input: {
    providerFamilyId: string;
  },
): Promise<string[]> {
  const targets = await context.db.query.integrationTargets.findMany({
    columns: {
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.enabled, true), eq(table.familyId, input.providerFamilyId)),
  });

  return targets.map((target) => target.targetKey);
}

async function prepareFormIntegrationSetup(
  context: MistleMcpServerContext,
  input: {
    targetKey: string;
    methodId: string;
    connectionId?: string | undefined;
    suggestedDisplayName?: string | undefined;
    suggestedConfig?: Record<string, unknown> | undefined;
  },
): Promise<Record<string, unknown>> {
  const target = await getTargetOrThrow(context, { targetKey: input.targetKey });
  const definition = getDefinitionOrThrow({
    integrationRegistry: context.integrationRegistry,
    target,
  });
  const method = getFormMethodOrThrow({
    definition,
    methodId: input.methodId,
    targetKey: target.targetKey,
  });
  const connection =
    input.connectionId === undefined
      ? undefined
      : await getConnectionOrThrow(context, { connectionId: input.connectionId });

  if (connection !== undefined && connection.targetKey !== target.targetKey) {
    throw new BadRequestError(
      "INVALID_FORM_SETUP_PREPARE_INPUT",
      `Integration connection '${connection.id}' does not belong to target '${target.targetKey}'.`,
    );
  }

  if (connection !== undefined) {
    requireMatchingFormMethodForUpdate({ connection, method });
  }

  const configuredSecretNames =
    connection === undefined
      ? []
      : await listConfiguredSecretNames({
          connection,
          context,
        });
  const currentConfig = readConnectionConfig(connection);
  const suggestedConfig = resolveSafeSuggestedConfig({
    method,
    suggestedConfig: input.suggestedConfig,
  });
  const safeCurrentConfig = stripSecretFieldsFromConfig({
    config: currentConfig,
    method,
  });
  const formContext = createFormContext({
    connection,
    currentValue: {
      ...safeCurrentConfig,
      ...suggestedConfig,
    },
    definition,
    target,
  });
  const resolvedForm =
    method.configSchema === undefined
      ? undefined
      : resolveIntegrationForm({
          schema: method.configSchema,
          form: method.configForm,
          context: formContext,
        });

  return {
    kind: "user_action_integration_setup_descriptor",
    actionKind: "form",
    targetKey: target.targetKey,
    methodId: method.id,
    methodLabel: method.label,
    mode: connection === undefined ? "create" : "update",
    ...(connection === undefined ? {} : { connectionId: connection.id }),
    ...(input.suggestedDisplayName === undefined
      ? {}
      : { suggestedDisplayName: input.suggestedDisplayName }),
    suggestedConfig,
    currentConfig: safeCurrentConfig,
    configuredSecretNames,
    secretFields: method.secretFields.map((field) => ({
      name: field.name,
      label: field.label,
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      ...(field.description === undefined ? {} : { description: field.description }),
      inputType: field.inputType,
      required: field.optional !== true,
      configured: configuredSecretNames.includes(field.name),
    })),
    directSubmission: {
      method: connection === undefined ? "POST" : "PUT",
      path:
        connection === undefined
          ? `${INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/${encodeURIComponent(target.targetKey)}/form`
          : `${INTEGRATION_CONNECTIONS_ROUTE_BASE_PATH}/${encodeURIComponent(connection.id)}/form`,
    },
    ...(resolvedForm === undefined
      ? {}
      : {
          form: {
            schema: resolvedForm.schema,
            ...(resolvedForm.uiSchema === undefined ? {} : { uiSchema: resolvedForm.uiSchema }),
          },
        }),
  };
}

function sanitizeMcpIntegrationConnectionResponse<
  TResponse extends {
    config?: Record<string, unknown> | undefined;
    connectionMethodId?: string | undefined;
  },
>(input: { response: TResponse; definition: AnyIntegrationDefinition | undefined }): TResponse {
  if (input.response.config === undefined) {
    return input.response;
  }

  const method = findFormMethodById({
    definition: input.definition,
    methodId: input.response.connectionMethodId,
  });

  if (method === undefined) {
    return input.response;
  }

  return {
    ...input.response,
    config: stripSecretFieldsFromConfig({
      config: input.response.config,
      method,
    }),
  };
}

function resolveSafeSuggestedConfig(input: {
  method: FormConnectionMethod;
  suggestedConfig: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  if (input.suggestedConfig === undefined) {
    return {};
  }

  const suggestedConfig = input.suggestedConfig;
  for (const field of input.method.secretFields) {
    if (Object.hasOwn(suggestedConfig, field.name)) {
      throw new BadRequestError(
        "INVALID_FORM_SETUP_PREPARE_INPUT",
        `Suggested config cannot include secret field '${field.name}'.`,
      );
    }
  }

  if (input.method.configSchema === undefined) {
    if (Object.keys(suggestedConfig).length > 0) {
      throw new BadRequestError(
        "INVALID_FORM_SETUP_PREPARE_INPUT",
        `Form connection method '${input.method.id}' does not accept suggested config.`,
      );
    }

    return {};
  }

  const parsed = input.method.configSchema.safeParse(suggestedConfig);
  if (!parsed.success) {
    throw new BadRequestError(
      "INVALID_FORM_SETUP_PREPARE_INPUT",
      `Suggested config for method '${input.method.id}' is invalid.`,
    );
  }

  return readRecord(parsed.data, "Suggested integration setup config");
}

function stripSecretFieldsFromConfig(input: {
  config: Record<string, unknown>;
  method: FormConnectionMethod;
}): Record<string, unknown> {
  const secretFieldNames = new Set(input.method.secretFields.map((field) => field.name));

  return Object.fromEntries(
    Object.entries(input.config).filter(([key]) => !secretFieldNames.has(key)),
  );
}

function requireMatchingFormMethodForUpdate(input: {
  connection: PersistedIntegrationConnection;
  method: FormConnectionMethod;
}): void {
  const connectionConfig = readConnectionConfig(input.connection);
  const connectionMethodId = connectionConfig["connection_method"];

  if (typeof connectionMethodId !== "string" || connectionMethodId.length === 0) {
    throw new BadRequestError(
      "INVALID_FORM_SETUP_PREPARE_INPUT",
      `Integration connection '${input.connection.id}' does not declare a form connection method.`,
    );
  }

  if (connectionMethodId !== input.method.id) {
    throw new BadRequestError(
      "INVALID_FORM_SETUP_PREPARE_INPUT",
      `Integration connection '${input.connection.id}' uses method '${connectionMethodId}', not '${input.method.id}'.`,
    );
  }
}

async function listConfiguredSecretNames(input: {
  connection: PersistedIntegrationConnection;
  context: MistleMcpServerContext;
}): Promise<string[]> {
  const configuredSecretNamesByConnectionId = await listConfiguredSecretNamesByConnectionId({
    connections: [input.connection],
    db: input.context.db,
    integrationRegistry: input.context.integrationRegistry,
  });

  return configuredSecretNamesByConnectionId.get(input.connection.id) ?? [];
}

function createFormContext(input: {
  connection: PersistedIntegrationConnection | undefined;
  currentValue: Record<string, unknown>;
  definition: Pick<AnyIntegrationDefinition, "kind" | "targetConfigSchema">;
  target: PersistedIntegrationTarget;
}): IntegrationFormContext {
  const targetConfig = input.definition.targetConfigSchema.parse(input.target.config);
  const targetConfigRecord = readRecord(targetConfig, "Integration target config");
  const targetRawConfig = readRecord(input.target.config, "Integration target raw config");
  const baseContext: IntegrationFormContext = {
    familyId: input.target.familyId,
    variantId: input.target.variantId,
    kind: input.definition.kind,
    target: {
      rawConfig: targetRawConfig,
      config: targetConfigRecord,
    },
    currentValue: input.currentValue,
  };

  if (input.connection === undefined) {
    return baseContext;
  }

  const connectionConfig = readConnectionConfig(input.connection);

  return {
    ...baseContext,
    connection: {
      id: input.connection.id,
      rawConfig: connectionConfig,
      config: connectionConfig,
    },
  };
}

async function getTargetOrThrow(
  context: MistleMcpServerContext,
  input: { targetKey: string },
): Promise<PersistedIntegrationTarget> {
  const target = await context.db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      "TARGET_NOT_FOUND",
      `Integration target '${input.targetKey}' was not found.`,
    );
  }

  return target;
}

async function getConnectionOrThrow(
  context: MistleMcpServerContext,
  input: { connectionId: string },
): Promise<PersistedIntegrationConnection> {
  const connection = await context.db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.connectionId),
        eq(table.organizationId, context.organizationActor.organizationId),
      ),
    with: {
      target: {
        columns: {
          familyId: true,
          variantId: true,
        },
      },
    },
  });

  if (connection === undefined) {
    throw new NotFoundError(
      "CONNECTION_NOT_FOUND",
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  return connection;
}

function getDefinitionOrThrow(input: {
  integrationRegistry: IntegrationRegistry;
  target: PersistedIntegrationTarget;
}): AnyIntegrationDefinition {
  const definition = input.integrationRegistry.getDefinition({
    familyId: input.target.familyId,
    variantId: input.target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      "INTEGRATION_DEFINITION_NOT_REGISTERED",
      `Integration definition '${input.target.familyId}/${input.target.variantId}' is not registered.`,
    );
  }

  return definition;
}

function getFormMethodOrThrow(input: {
  definition: AnyIntegrationDefinition;
  methodId: string;
  targetKey: string;
}): FormConnectionMethod {
  const method = findFormMethodById({
    definition: input.definition,
    methodId: input.methodId,
  });

  if (method === undefined) {
    throw new BadRequestError(
      "FORM_CONNECTION_METHOD_NOT_SUPPORTED",
      `Integration target '${input.targetKey}' does not support form connection method '${input.methodId}'.`,
    );
  }

  return method;
}

function findFormMethodById(input: {
  definition: AnyIntegrationDefinition | undefined;
  methodId: string | undefined;
}): FormConnectionMethod | undefined {
  return input.definition?.connectionMethods.find(
    (entry): entry is FormConnectionMethod => entry.kind === "form" && entry.id === input.methodId,
  );
}

function readConnectionConfig(
  connection: Pick<IntegrationConnection, "config"> | undefined,
): Record<string, unknown> {
  if (connection === undefined || connection.config === null) {
    return {};
  }

  return readRecord(connection.config, "Integration connection config");
}

function normalizeDateString(value: string | Date): string {
  return new Date(value).toISOString();
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  const parsed = UnknownRecordSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`${label} must be an object.`);
}
