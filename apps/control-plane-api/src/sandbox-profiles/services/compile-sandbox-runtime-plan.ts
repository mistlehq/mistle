import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  CompilerErrorCodes,
  IntegrationCompilerError,
  compileRuntimePlan,
  type CompiledRuntimePlan,
  type IntegrationRegistry,
  type ResolvedSandboxImage,
} from "@mistle/integrations-core";

type IntegrationTargetEncryptedSecretsInput = {
  ciphertext: string;
  nonce: string;
  masterKeyVersion: number;
};

export const SandboxRuntimePlanCompilerErrorCodes = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_VERSION_NOT_FOUND: "PROFILE_VERSION_NOT_FOUND",
  INVALID_BINDING_CONNECTION_REFERENCE: "INVALID_BINDING_CONNECTION_REFERENCE",
  INVALID_CONNECTION_TARGET_REFERENCE: "INVALID_CONNECTION_TARGET_REFERENCE",
  CONNECTION_MISMATCH: "CONNECTION_MISMATCH",
  TARGET_DISABLED: "TARGET_DISABLED",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  KIND_MISMATCH: "KIND_MISMATCH",
  INVALID_TARGET_CONFIG: "INVALID_TARGET_CONFIG",
  INVALID_TARGET_SECRETS: "INVALID_TARGET_SECRETS",
  INVALID_BINDING_CONFIG: "INVALID_BINDING_CONFIG",
  ROUTE_CONFLICT: "ROUTE_CONFLICT",
  ARTIFACT_CONFLICT: "ARTIFACT_CONFLICT",
  RUNTIME_CLIENT_SETUP_CONFLICT: "RUNTIME_CLIENT_SETUP_CONFLICT",
  RUNTIME_CLIENT_SETUP_INVALID_REF: "RUNTIME_CLIENT_SETUP_INVALID_REF",
} as const;

export type SandboxRuntimePlanCompilerErrorCode =
  (typeof SandboxRuntimePlanCompilerErrorCodes)[keyof typeof SandboxRuntimePlanCompilerErrorCodes];

export class SandboxRuntimePlanCompilerError extends Error {
  readonly code: SandboxRuntimePlanCompilerErrorCode;

  constructor(input: {
    code: SandboxRuntimePlanCompilerErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, {
      cause: input.cause,
    });
    this.name = "SandboxRuntimePlanCompilerError";
    this.code = input.code;
  }
}

export type ResolveIntegrationTargetSecretsInput = {
  targets: ReadonlyArray<{
    targetKey: string;
    encryptedSecrets: IntegrationTargetEncryptedSecretsInput | null;
  }>;
};

export type ResolveIntegrationTargetSecretsOutput = ReadonlyArray<{
  targetKey: string;
  secrets: Record<string, string>;
}>;

export type ResolveIntegrationTargetSecrets = (
  input: ResolveIntegrationTargetSecretsInput,
) => Promise<ResolveIntegrationTargetSecretsOutput>;

export type CompileSandboxRuntimePlanInput = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  resolveTargetSecrets: ResolveIntegrationTargetSecrets;
  organizationId: string;
  profileId: string;
  profileVersion: number;
  image: ResolvedSandboxImage;
};

function mapCompilerErrorCodeToSandboxRuntimePlanCompilerErrorCode(
  code: IntegrationCompilerError["code"],
): SandboxRuntimePlanCompilerErrorCode {
  switch (code) {
    case CompilerErrorCodes.CONNECTION_MISMATCH:
      return SandboxRuntimePlanCompilerErrorCodes.CONNECTION_MISMATCH;
    case CompilerErrorCodes.TARGET_DISABLED:
      return SandboxRuntimePlanCompilerErrorCodes.TARGET_DISABLED;
    case CompilerErrorCodes.CONNECTION_NOT_ACTIVE:
      return SandboxRuntimePlanCompilerErrorCodes.CONNECTION_NOT_ACTIVE;
    case CompilerErrorCodes.KIND_MISMATCH:
      return SandboxRuntimePlanCompilerErrorCodes.KIND_MISMATCH;
    case CompilerErrorCodes.INVALID_TARGET_CONFIG:
      return SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_CONFIG;
    case CompilerErrorCodes.INVALID_TARGET_SECRETS:
      return SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS;
    case CompilerErrorCodes.INVALID_BINDING_CONFIG:
      return SandboxRuntimePlanCompilerErrorCodes.INVALID_BINDING_CONFIG;
    case CompilerErrorCodes.ROUTE_CONFLICT:
      return SandboxRuntimePlanCompilerErrorCodes.ROUTE_CONFLICT;
    case CompilerErrorCodes.ARTIFACT_CONFLICT:
      return SandboxRuntimePlanCompilerErrorCodes.ARTIFACT_CONFLICT;
    case CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT:
      return SandboxRuntimePlanCompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT;
    case CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF:
      return SandboxRuntimePlanCompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF;
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

function indexResolvedTargetSecrets(input: {
  targets: ReadonlyArray<{
    targetKey: string;
    encryptedSecrets: IntegrationTargetEncryptedSecretsInput | null;
  }>;
  resolvedTargetSecrets: ResolveIntegrationTargetSecretsOutput;
}): Map<string, Record<string, string>> {
  const targetSecretsByTargetKey = new Map<string, Record<string, string>>();

  for (const resolvedTargetSecrets of input.resolvedTargetSecrets) {
    if (targetSecretsByTargetKey.has(resolvedTargetSecrets.targetKey)) {
      throw new SandboxRuntimePlanCompilerError({
        code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
        message: `Duplicate target secrets were returned for '${resolvedTargetSecrets.targetKey}'.`,
      });
    }

    targetSecretsByTargetKey.set(resolvedTargetSecrets.targetKey, resolvedTargetSecrets.secrets);
  }

  for (const target of input.targets) {
    if (!targetSecretsByTargetKey.has(target.targetKey)) {
      throw new SandboxRuntimePlanCompilerError({
        code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
        message: `Resolved target secrets are missing an entry for '${target.targetKey}'.`,
      });
    }
  }

  return targetSecretsByTargetKey;
}

async function resolveCompileBindingsForVersion(
  input: Pick<
    CompileSandboxRuntimePlanInput,
    "db" | "resolveTargetSecrets" | "organizationId" | "profileId" | "profileVersion"
  >,
) {
  const integrationBindings =
    await input.db.query.sandboxProfileVersionIntegrationBindings.findMany({
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
      : await input.db.query.integrationConnections.findMany({
          where: (table, { and, eq, inArray }) =>
            and(eq(table.organizationId, input.organizationId), inArray(table.id, connectionIds)),
        });

  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const targetKeys = [...new Set(connections.map((connection) => connection.targetKey))];
  const targets =
    targetKeys.length === 0
      ? []
      : await input.db.query.integrationTargets.findMany({
          where: (table, { inArray }) => inArray(table.targetKey, targetKeys),
        });
  const targetsByKey = new Map(targets.map((target) => [target.targetKey, target]));

  const targetSecretsByTargetKey = indexResolvedTargetSecrets({
    targets: targets.map((target) => ({
      targetKey: target.targetKey,
      encryptedSecrets: target.secrets,
    })),
    resolvedTargetSecrets: await input.resolveTargetSecrets({
      targets: targets.map((target) => ({
        targetKey: target.targetKey,
        encryptedSecrets: target.secrets,
      })),
    }),
  });

  return integrationBindings.map((binding) => {
    const connection = connectionsById.get(binding.connectionId);
    if (connection === undefined) {
      throw new SandboxRuntimePlanCompilerError({
        code: SandboxRuntimePlanCompilerErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        message: `Binding '${binding.id}' references connection '${binding.connectionId}' that is missing or inaccessible.`,
      });
    }

    const target = targetsByKey.get(connection.targetKey);
    if (target === undefined) {
      throw new SandboxRuntimePlanCompilerError({
        code: SandboxRuntimePlanCompilerErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
        message: `Connection '${connection.id}' references target '${connection.targetKey}' that does not exist.`,
      });
    }

    const resolvedTargetSecrets = targetSecretsByTargetKey.get(target.targetKey);
    if (resolvedTargetSecrets === undefined) {
      throw new SandboxRuntimePlanCompilerError({
        code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
        message: `Target '${target.targetKey}' resolved without decrypted secrets.`,
      });
    }

    return {
      targetKey: target.targetKey,
      target: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: target.config,
        secrets: resolvedTargetSecrets,
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
}

export async function compileSandboxRuntimePlan(
  input: CompileSandboxRuntimePlanInput,
): Promise<CompiledRuntimePlan> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxRuntimePlanCompilerError({
      code: SandboxRuntimePlanCompilerErrorCodes.PROFILE_NOT_FOUND,
      message: "Sandbox profile was not found.",
    });
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxRuntimePlanCompilerError({
      code: SandboxRuntimePlanCompilerErrorCodes.PROFILE_VERSION_NOT_FOUND,
      message: "Sandbox profile version was not found.",
    });
  }

  const compileBindings = await resolveCompileBindingsForVersion({
    db: input.db,
    resolveTargetSecrets: input.resolveTargetSecrets,
    organizationId: input.organizationId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
  });

  try {
    return compileRuntimePlan({
      organizationId: input.organizationId,
      sandboxProfileId: input.profileId,
      version: input.profileVersion,
      image: input.image,
      bindings: compileBindings,
      registry: input.integrationRegistry,
    });
  } catch (error) {
    if (error instanceof IntegrationCompilerError) {
      throw new SandboxRuntimePlanCompilerError({
        code: mapCompilerErrorCodeToSandboxRuntimePlanCompilerErrorCode(error.code),
        message: error.message,
        cause: error,
      });
    }

    throw error;
  }
}
