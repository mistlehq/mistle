import {
  CompilerErrorCodes,
  compileRuntimePlan,
  IntegrationCompilerError,
  type CompiledRuntimePlan,
  type ResolvedSandboxImage,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";

import {
  SandboxProfilesCompileError,
  type SandboxProfilesCompileErrorCode,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type CompileProfileVersionRuntimePlanInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  image: ResolvedSandboxImage;
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
};

const registry = createIntegrationRegistry();

function mapCompilerErrorCodeToSandboxProfilesCompileErrorCode(
  code: IntegrationCompilerError["code"],
): SandboxProfilesCompileErrorCode {
  switch (code) {
    case CompilerErrorCodes.CONNECTION_MISMATCH:
      return SandboxProfilesCompileErrorCodes.CONNECTION_MISMATCH;
    case CompilerErrorCodes.TARGET_DISABLED:
      return SandboxProfilesCompileErrorCodes.TARGET_DISABLED;
    case CompilerErrorCodes.CONNECTION_NOT_ACTIVE:
      return SandboxProfilesCompileErrorCodes.CONNECTION_NOT_ACTIVE;
    case CompilerErrorCodes.KIND_MISMATCH:
      return SandboxProfilesCompileErrorCodes.KIND_MISMATCH;
    case CompilerErrorCodes.INVALID_TARGET_CONFIG:
      return SandboxProfilesCompileErrorCodes.INVALID_TARGET_CONFIG;
    case CompilerErrorCodes.INVALID_BINDING_CONFIG:
      return SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONFIG;
    case CompilerErrorCodes.ROUTE_CONFLICT:
      return SandboxProfilesCompileErrorCodes.ROUTE_CONFLICT;
    case CompilerErrorCodes.ARTIFACT_CONFLICT:
      return SandboxProfilesCompileErrorCodes.ARTIFACT_CONFLICT;
    case CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT:
      return SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT;
    case CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF:
      return SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF;
  }

  throw new Error(`Unhandled compiler error code '${code}'.`);
}

function normalizeConnectionConfig(
  connectionConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  if (connectionConfig === null) {
    return {};
  }

  return connectionConfig;
}

export async function compileProfileVersionRuntimePlan(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: CompileProfileVersionRuntimePlanInput,
): Promise<CompiledRuntimePlan> {
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
      sandboxProfileId: true,
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

  const integrationBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.profileId),
        eq(table.sandboxProfileVersion, input.profileVersion),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  const connectionIds = integrationBindings.map((binding) => binding.connectionId);
  const connections =
    connectionIds.length === 0
      ? []
      : await db.query.integrationConnections.findMany({
          where: (table, { and, eq, inArray }) =>
            and(eq(table.organizationId, input.organizationId), inArray(table.id, connectionIds)),
        });

  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const targetKeys = [...new Set(connections.map((connection) => connection.targetKey))];
  const targets =
    targetKeys.length === 0
      ? []
      : await db.query.integrationTargets.findMany({
          where: (table, { inArray }) => inArray(table.targetKey, targetKeys),
        });
  const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));

  const compileBindings = integrationBindings.map((binding) => {
    const connection = connectionsById.get(binding.connectionId);
    if (connection === undefined) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        `Binding '${binding.id}' references connection '${binding.connectionId}' that is missing or inaccessible.`,
      );
    }

    const target = targetsByKey.get(connection.targetKey);
    if (target === undefined) {
      throw new SandboxProfilesCompileError(
        SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
        `Connection '${connection.id}' references target '${connection.targetKey}' that does not exist.`,
      );
    }

    return {
      targetKey: target.targetKey,
      target: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: target.config,
      },
      connection: {
        id: connection.id,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        config: normalizeConnectionConfig(connection.config),
      },
      binding: {
        id: binding.id,
        kind: binding.kind,
        connectionId: binding.connectionId,
        config: binding.config,
      },
    };
  });

  try {
    return compileRuntimePlan({
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      version: input.profileVersion,
      image: input.image,
      runtimeContext: input.runtimeContext,
      bindings: compileBindings,
      registry,
    });
  } catch (error) {
    if (error instanceof IntegrationCompilerError) {
      throw new SandboxProfilesCompileError(
        mapCompilerErrorCodeToSandboxProfilesCompileErrorCode(error.code),
        error.message,
      );
    }

    throw error;
  }
}

export type { CompileProfileVersionRuntimePlanInput };
