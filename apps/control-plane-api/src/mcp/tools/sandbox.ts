import { BadRequestError } from "@mistle/http/errors.js";
import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH } from "../../public-port-access-links/index.js";
import { SANDBOX_INSTANCE_PORT_ACCESS_LINK_TTL_SECONDS } from "../../sandbox-instances/constants.js";
import { getInstance } from "../../sandbox-instances/services/get-instance.js";
import { listOperationEvents } from "../../sandbox-instances/services/list-operation-events.js";
import { mintPortAccess } from "../../sandbox-instances/services/mint-port-access.js";
import type { SandboxProfileVersionResources } from "../../sandbox-profiles/services/profile-version-runtime-config.js";
import { startProfileMaintenanceScriptTestRun } from "../../sandbox-profiles/services/start-profile-maintenance-script-test-run.js";
import { startProfileSetupScriptTestRun } from "../../sandbox-profiles/services/start-profile-setup-script-test-run.js";
import type { AppOrganizationActor } from "../../types.js";
import type { MistleMcpServerContext } from "../server.js";
import {
  mcpProfileMaintenanceScriptTestStartInputSchema,
  mcpProfileSetupScriptTestStartInputSchema,
  mcpSandboxInstanceIdParamsSchema,
  mcpSandboxInstancePortAccessCreateInputSchema,
  mcpSandboxOperationEventsListInputSchema,
} from "../tool-schemas.js";
import {
  requireMcpSandboxInstanceScope,
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

const DefaultSandboxOperationEventsLimit = 20;

export function registerSandboxTools(server: McpServer, context: MistleMcpServerContext): void {
  server.registerTool(
    "profile_setup_script_test_start",
    {
      title: "Start sandbox profile setup script test",
      description: "Start a sandbox to test a sandbox profile setup script",
      inputSchema: mcpProfileSetupScriptTestStartInputSchema,
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
      requireNonBlankMcpScript({ field: "setupScript", value: setupScript });
      const sandboxRuntimeOverride = resolveMcpSandboxRuntimeOverride({
        sandboxConnectionId,
        sandboxResources,
        sandboxProvider,
      });
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
          ...sandboxRuntimeOverride,
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
        "Start a sandbox from the current snapshot to test a sandbox profile maintenance script",
      inputSchema: mcpProfileMaintenanceScriptTestStartInputSchema,
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
      requireNonBlankMcpScript({ field: "maintenanceScript", value: maintenanceScript });
      const sandboxRuntimeOverride = resolveMcpSandboxRuntimeOverride({
        sandboxConnectionId,
        sandboxResources,
        sandboxProvider,
      });
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
          ...sandboxRuntimeOverride,
          startedBy: resolveStartedBy(context.organizationActor),
          source: "dashboard",
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        },
      );

      return structuredResult(startedTestRun);
    },
  );

  server.registerTool(
    "sandbox_instance_port_access_create",
    {
      title: "Create sandbox Port Access link",
      description: "Create a short-lived public URL for accessing one port on a sandbox instance",
      inputSchema: mcpSandboxInstancePortAccessCreateInputSchema,
      annotations: {
        ...MutatingToolAnnotations,
        title: "Create sandbox Port Access link",
      },
    },
    async ({ instanceId, port }) => {
      requireMcpToolPermission(
        context.organizationActor,
        OrganizationPermissions.SANDBOX_SESSION_CONNECT,
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
      requireMcpSandboxInstanceScope(context.organizationActor, {
        sandboxInstanceId: sandboxInstance.id,
      });

      const portAccess = await mintPortAccess(
        {
          dataPlaneClient: context.dataPlaneClient,
        },
        {
          db: context.db,
          organizationId: context.organizationActor.organizationId,
          instanceId,
          port,
          baseDomain: context.portAccessConfig.baseDomain,
          publicBaseUrl: context.dashboardBaseUrl,
          linkPathBase: PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH,
          linkTtlSeconds: SANDBOX_INSTANCE_PORT_ACCESS_LINK_TTL_SECONDS,
          createdBy: resolvePortAccessLinkCreatedBy(context.organizationActor),
          clock: context.clock,
        },
      );

      return structuredResult(portAccess);
    },
  );

  server.registerTool(
    "sandbox_instance_get",
    {
      title: "Get sandbox instance",
      description: "Get sandbox instance provisioning and runtime status",
      inputSchema: mcpSandboxInstanceIdParamsSchema,
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
      inputSchema: mcpSandboxOperationEventsListInputSchema,
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
          limit: limit ?? DefaultSandboxOperationEventsLimit,
        },
      );

      return structuredResult(operationEvents);
    },
  );
}

function requireNonBlankMcpScript(input: {
  field: "setupScript" | "maintenanceScript";
  value: string;
}): void {
  if (input.value.trim().length > 0) {
    return;
  }

  throw new BadRequestError(
    "BAD_REQUEST",
    input.field === "setupScript"
      ? "Setup script must not be blank."
      : "Maintenance script must not be blank.",
  );
}

function requireMcpSandboxProviderForRuntimeOverride(input: {
  sandboxProvider: string | undefined;
  sandboxConnectionId: string | null | undefined;
  sandboxResources: object | null | undefined;
}): void {
  if (
    (input.sandboxConnectionId === undefined && input.sandboxResources === undefined) ||
    input.sandboxProvider !== undefined
  ) {
    return;
  }

  throw new BadRequestError(
    "BAD_REQUEST",
    "Sandbox provider is required when sandbox runtime override fields are provided.",
  );
}

function resolveMcpSandboxRuntimeOverride(input: {
  sandboxProvider: string | undefined;
  sandboxConnectionId: string | null | undefined;
  sandboxResources: SandboxProfileVersionResources | null | undefined;
}): {
  sandboxRuntimeConfig?: {
    sandboxProvider: string;
    sandboxConnectionId: string | null;
    sandboxResources: SandboxProfileVersionResources | null;
  };
} {
  requireMcpSandboxProviderForRuntimeOverride(input);

  if (input.sandboxProvider === undefined) {
    return {};
  }

  return {
    sandboxRuntimeConfig: {
      sandboxProvider: input.sandboxProvider,
      sandboxConnectionId: input.sandboxConnectionId ?? null,
      sandboxResources: input.sandboxResources ?? null,
    },
  };
}

function resolvePortAccessLinkCreatedBy(organizationActor: AppOrganizationActor): {
  kind: "agent" | "user";
  id: string;
} {
  if (organizationActor.kind === "api_key") {
    return {
      kind: "agent",
      id: organizationActor.apiKeyId,
    };
  }

  if (organizationActor.kind === "mcp_capability") {
    return {
      kind: "agent",
      id: organizationActor.capability.sandboxInstanceId,
    };
  }

  return {
    kind: "user",
    id: organizationActor.userId,
  };
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
