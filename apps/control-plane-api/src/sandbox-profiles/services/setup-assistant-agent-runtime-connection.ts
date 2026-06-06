import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { IntegrationBindingKinds, IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { agentDefinitionAllowsRuntime } from "@mistle/integrations-definitions/server";

import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";

type AssertSetupAssistantAgentRuntimeConnectionInput = {
  integrationRegistry: IntegrationRegistry;
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

export async function assertSetupAssistantAgentRuntimeConnection(
  db: ControlPlaneDatabase,
  input: AssertSetupAssistantAgentRuntimeConnectionInput,
): Promise<void> {
  const profileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      agentRuntimeId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });
  if (profileVersion === undefined) {
    return;
  }

  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      id: true,
      connectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
        eq(table.kind, IntegrationBindingKinds.AGENT),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  if (agentBindings.length === 0) {
    throwAgentRuntimeConnectionRequired(input);
  }

  let hasCompatibleAgentRuntimeConnection = false;
  for (const binding of agentBindings) {
    const connection = await db.query.integrationConnections.findFirst({
      columns: {
        id: true,
        status: true,
        targetKey: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, binding.connectionId), eq(table.organizationId, input.organizationId)),
    });
    if (connection === undefined) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        `Agent binding '${binding.id}' references connection '${binding.connectionId}' that is missing or inaccessible.`,
      );
    }

    if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.CONNECTION_NOT_ACTIVE,
        `Agent binding '${binding.id}' references connection '${connection.id}' that is not active.`,
      );
    }

    const target = await db.query.integrationTargets.findFirst({
      columns: {
        enabled: true,
        familyId: true,
        targetKey: true,
        variantId: true,
      },
      where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
    });
    if (target === undefined) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
        `Connection '${connection.id}' references target '${connection.targetKey}' that does not exist.`,
      );
    }

    if (!target.enabled) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.TARGET_DISABLED,
        `Agent binding '${binding.id}' references disabled target '${target.targetKey}'.`,
      );
    }

    const definition = input.integrationRegistry.getDefinition({
      familyId: target.familyId,
      variantId: target.variantId,
    });
    if (
      agentDefinitionAllowsRuntime({
        definition,
        runtimeId: profileVersion.agentRuntimeId,
      })
    ) {
      hasCompatibleAgentRuntimeConnection = true;
    }
  }

  if (!hasCompatibleAgentRuntimeConnection) {
    throwAgentRuntimeConnectionRequired(input);
  }
}

function throwAgentRuntimeConnectionRequired(
  input: AssertSetupAssistantAgentRuntimeConnectionInput,
): never {
  throw new SandboxProfilesCompileError(
    SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_CONNECTION_REQUIRED,
    `Sandbox profile '${input.profileId}' version ${String(input.profileVersion)} needs a saved agent runtime connection before starting Setup Assistant.`,
  );
}
