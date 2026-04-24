import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";
import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";

import {
  SandboxProfilePublishabilityIssueCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
  type SandboxProfilePublishabilityIssueCode,
} from "../errors.js";

export type SandboxProfilePublishabilityIssue = {
  code: SandboxProfilePublishabilityIssueCode;
  message: string;
  bindingId?: string;
  connectionId?: string;
  targetKey?: string;
};

type GetProfileVersionPublishabilityInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type GetProfileVersionPublishabilityOutput = {
  publishable: boolean;
  issues: SandboxProfilePublishabilityIssue[];
};

export async function getProfileVersionPublishability(
  { db }: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: GetProfileVersionPublishabilityInput,
): Promise<GetProfileVersionPublishabilityOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      state: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  if (sandboxProfileVersion.state !== SandboxProfileVersionStates.DRAFT) {
    return {
      publishable: false,
      issues: [
        {
          code: SandboxProfilePublishabilityIssueCodes.PROFILE_VERSION_NOT_DRAFT,
          message: `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
        },
      ],
    };
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
    return {
      publishable: false,
      issues: [
        {
          code: SandboxProfilePublishabilityIssueCodes.AGENT_BINDING_REQUIRED,
          message:
            "Sandbox profile version must declare at least one agent binding before it can be published.",
        },
      ],
    };
  }

  const accessibleConnections = await db.query.integrationConnections.findMany({
    columns: {
      id: true,
      status: true,
      targetKey: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.organizationId, input.organizationId),
        inArray(
          table.id,
          agentBindings.map((binding) => binding.connectionId),
        ),
      ),
  });
  const accessibleConnectionsById = new Map(
    accessibleConnections.map((connection) => [connection.id, connection]),
  );

  const targets = await db.query.integrationTargets.findMany({
    columns: {
      targetKey: true,
      enabled: true,
    },
    where: (table, { inArray }) =>
      inArray(
        table.targetKey,
        accessibleConnections.map((connection) => connection.targetKey),
      ),
  });
  const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));

  const issues: SandboxProfilePublishabilityIssue[] = [];

  for (const binding of agentBindings) {
    const connection = accessibleConnectionsById.get(binding.connectionId);

    if (connection === undefined) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        message: `Agent binding '${binding.id}' references connection '${binding.connectionId}' that is missing or inaccessible.`,
        bindingId: binding.id,
        connectionId: binding.connectionId,
      });
      continue;
    }

    if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.CONNECTION_NOT_ACTIVE,
        message: `Agent binding '${binding.id}' references connection '${binding.connectionId}' that is not active.`,
        bindingId: binding.id,
        connectionId: binding.connectionId,
      });
      continue;
    }

    const target = targetsByKey.get(connection.targetKey);

    if (target === undefined) {
      throw new Error(
        `Expected integration target '${connection.targetKey}' to exist for connection '${binding.connectionId}'.`,
      );
    }

    if (!target.enabled) {
      issues.push({
        code: SandboxProfilePublishabilityIssueCodes.TARGET_DISABLED,
        message: `Agent binding '${binding.id}' references disabled target '${target.targetKey}'.`,
        bindingId: binding.id,
        connectionId: binding.connectionId,
        targetKey: target.targetKey,
      });
    }
  }

  return {
    publishable: issues.length === 0,
    issues,
  };
}
