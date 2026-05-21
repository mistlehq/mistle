import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import {
  sandboxInstanceIdParamsSchema,
  sandboxInstanceStatusResponseSchema,
  sandboxOperationEventsQuerySchema,
  sandboxOperationEventsResponseSchema,
} from "../../sandbox-instances/schemas.js";
import { getInstance } from "../../sandbox-instances/services/get-instance.js";
import { listOperationEvents } from "../../sandbox-instances/services/list-operation-events.js";
import {
  sandboxProfileVersionParamsSchema,
  startSandboxProfileMaintenanceScriptTestRunBodySchema,
  startSandboxProfileSetupScriptTestRunBodySchema,
  startSandboxProfileSetupScriptTestRunResponseSchema,
} from "../../sandbox-profiles/schemas.js";
import { startProfileMaintenanceScriptTestRun } from "../../sandbox-profiles/services/start-profile-maintenance-script-test-run.js";
import { startProfileSetupScriptTestRun } from "../../sandbox-profiles/services/start-profile-setup-script-test-run.js";
import type { AppOrganizationActor } from "../../types.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  requireMcpSandboxInstanceProfileScope,
  requireMcpSandboxProfileScope,
  requireMcpToolPermission,
  structuredResult,
} from "./shared.js";

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

const profileSetupScriptTestStartInputSchema =
  startSandboxProfileSetupScriptTestRunBodySchema.safeExtend(
    sandboxProfileVersionParamsSchema.shape,
  );

const profileMaintenanceScriptTestStartInputSchema =
  startSandboxProfileMaintenanceScriptTestRunBodySchema.safeExtend(
    sandboxProfileVersionParamsSchema.shape,
  );

const sandboxOperationEventsListInputSchema = sandboxOperationEventsQuerySchema.safeExtend(
  sandboxInstanceIdParamsSchema.shape,
);

export function registerSandboxTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "profile_setup_script_test_start",
    {
      title: "Start sandbox profile setup script test",
      description: "Start an ephemeral sandbox to test a sandbox profile setup script",
      inputSchema: profileSetupScriptTestStartInputSchema,
      outputSchema: startSandboxProfileSetupScriptTestRunResponseSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Start sandbox profile setup script test",
      },
    },
    async ({
      agentRuntimeId,
      idempotencyKey,
      profileId,
      sandboxConnectionId,
      sandboxProvider,
      sandboxResources,
      setupScript,
      version,
    }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const startedTestRun = await startProfileSetupScriptTestRun(
        {
          dataPlaneClient: context.dataPlaneClient,
          db: context.db,
          defaultBaseImage: context.sandboxConfig.defaultBaseImage,
          integrationRegistry: context.integrationRegistry,
          integrationsConfig: context.integrationsConfig,
          mcpConfig: context.mcpConfig,
          sandboxConfig: context.sandboxConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
          setupScript,
          ...(agentRuntimeId === undefined ? {} : { agentRuntimeId }),
          ...(sandboxProvider === undefined
            ? {}
            : {
                sandboxRuntimeConfig: {
                  sandboxProvider,
                  sandboxConnectionId: sandboxConnectionId ?? null,
                  sandboxResources: sandboxResources ?? null,
                },
              }),
          startedBy: resolveStartedBy(context.organizationActor),
          source: "dashboard",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        },
      );

      return structuredResult(startedTestRun);
    },
  );

  server.registerTool(
    "profile_maintenance_script_test_start",
    {
      title: "Start sandbox profile maintenance script test",
      description:
        "Start an ephemeral sandbox from the current snapshot to test a sandbox profile maintenance script",
      inputSchema: profileMaintenanceScriptTestStartInputSchema,
      outputSchema: startSandboxProfileSetupScriptTestRunResponseSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Start sandbox profile maintenance script test",
      },
    },
    async ({
      agentRuntimeId,
      idempotencyKey,
      maintenanceScript,
      profileId,
      sandboxConnectionId,
      sandboxProvider,
      sandboxResources,
      version,
    }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      );
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      );
      requireMcpSandboxProfileScope(context.organizationActor, {
        profileId,
        version,
      });

      const startedTestRun = await startProfileMaintenanceScriptTestRun(
        {
          dataPlaneClient: context.dataPlaneClient,
          db: context.db,
          defaultBaseImage: context.sandboxConfig.defaultBaseImage,
          integrationRegistry: context.integrationRegistry,
          integrationsConfig: context.integrationsConfig,
          mcpConfig: context.mcpConfig,
          sandboxConfig: context.sandboxConfig,
        },
        {
          organizationId: context.organizationActor.organizationId,
          profileId,
          profileVersion: version,
          maintenanceScript,
          ...(agentRuntimeId === undefined ? {} : { agentRuntimeId }),
          ...(sandboxProvider === undefined
            ? {}
            : {
                sandboxRuntimeConfig: {
                  sandboxProvider,
                  sandboxConnectionId: sandboxConnectionId ?? null,
                  sandboxResources: sandboxResources ?? null,
                },
              }),
          startedBy: resolveStartedBy(context.organizationActor),
          source: "dashboard",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        },
      );

      return structuredResult(startedTestRun);
    },
  );

  server.registerTool(
    "sandbox_instance_get",
    {
      title: "Get sandbox instance",
      description: "Get sandbox instance provisioning and runtime status",
      inputSchema: sandboxInstanceIdParamsSchema,
      outputSchema: sandboxInstanceStatusResponseSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "Get sandbox instance",
      },
    },
    async ({ instanceId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_SESSION_READ,
      );

      const sandboxInstance = await getInstance(
        {
          dataPlaneClient: context.dataPlaneClient,
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          instanceId,
        },
      );
      requireMcpSandboxInstanceProfileScope(context.organizationActor, {
        sandboxProfileId: sandboxInstance.sandboxProfileId,
        sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      });

      return structuredResult(sandboxInstance);
    },
  );

  server.registerTool(
    "sandbox_operation_events_list",
    {
      title: "List sandbox operation events",
      description: "List lifecycle and transcript events for a sandbox operation",
      inputSchema: sandboxOperationEventsListInputSchema,
      outputSchema: sandboxOperationEventsResponseSchema,
      annotations: {
        ...ReadOnlyToolAnnotations,
        title: "List sandbox operation events",
      },
    },
    async ({ afterSequence, instanceId, limit, operationId }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_SESSION_READ,
      );

      const sandboxInstance = await getInstance(
        {
          dataPlaneClient: context.dataPlaneClient,
          db: context.db,
        },
        {
          organizationId: context.organizationActor.organizationId,
          instanceId,
        },
      );
      requireMcpSandboxInstanceProfileScope(context.organizationActor, {
        sandboxProfileId: sandboxInstance.sandboxProfileId,
        sandboxProfileVersion: sandboxInstance.sandboxProfileVersion,
      });

      const operationEvents = await listOperationEvents(
        {
          dataPlaneClient: context.dataPlaneClient,
        },
        {
          organizationId: context.organizationActor.organizationId,
          sandboxInstanceId: instanceId,
          operationId,
          ...(afterSequence === undefined ? {} : { afterSequence }),
          ...(limit === undefined ? {} : { limit }),
        },
      );

      return structuredResult(operationEvents);
    },
  );
}

function resolveStartedBy(organizationActor: AppOrganizationActor): {
  kind: "api_key" | "system" | "user";
  id: string;
} {
  if (organizationActor.kind === "api_key") {
    return {
      kind: "api_key",
      id: organizationActor.apiKeyId,
    };
  }

  if (organizationActor.kind === "mcp_capability") {
    return {
      kind: "system",
      id: organizationActor.capability.sandboxInstanceId,
    };
  }

  return {
    kind: "user",
    id: organizationActor.userId,
  };
}
