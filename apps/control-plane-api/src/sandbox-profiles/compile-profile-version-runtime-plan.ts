import type { CompiledRuntimePlan, ResolvedSandboxImage } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";

import { resolveIntegrationTargetSecrets } from "../lib/integration-target-secrets.js";
import {
  SandboxProfilesCompileError,
  type SandboxProfilesCompileErrorCode,
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "./errors.js";
import {
  SandboxRuntimePlanCompilerError,
  SandboxRuntimePlanCompilerErrorCodes,
  compileSandboxRuntimePlan,
} from "./services/compile-sandbox-runtime-plan.js";
import type { CreateSandboxProfilesServiceInput } from "./services/types.js";

type CompileProfileVersionRuntimePlanInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  image: ResolvedSandboxImage;
};

const registry = createIntegrationRegistry();

function mapCompilerErrorCodeToSandboxProfilesCompileErrorCode(
  code: Exclude<
    (typeof SandboxRuntimePlanCompilerErrorCodes)[keyof typeof SandboxRuntimePlanCompilerErrorCodes],
    | (typeof SandboxRuntimePlanCompilerErrorCodes)["PROFILE_NOT_FOUND"]
    | (typeof SandboxRuntimePlanCompilerErrorCodes)["PROFILE_VERSION_NOT_FOUND"]
  >,
): SandboxProfilesCompileErrorCode {
  switch (code) {
    case SandboxRuntimePlanCompilerErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE:
      return SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE;
    case SandboxRuntimePlanCompilerErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE:
      return SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE;
    case SandboxRuntimePlanCompilerErrorCodes.CONNECTION_MISMATCH:
      return SandboxProfilesCompileErrorCodes.CONNECTION_MISMATCH;
    case SandboxRuntimePlanCompilerErrorCodes.TARGET_DISABLED:
      return SandboxProfilesCompileErrorCodes.TARGET_DISABLED;
    case SandboxRuntimePlanCompilerErrorCodes.CONNECTION_NOT_ACTIVE:
      return SandboxProfilesCompileErrorCodes.CONNECTION_NOT_ACTIVE;
    case SandboxRuntimePlanCompilerErrorCodes.KIND_MISMATCH:
      return SandboxProfilesCompileErrorCodes.KIND_MISMATCH;
    case SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_CONFIG:
      return SandboxProfilesCompileErrorCodes.INVALID_TARGET_CONFIG;
    case SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS:
      return SandboxProfilesCompileErrorCodes.INVALID_TARGET_SECRETS;
    case SandboxRuntimePlanCompilerErrorCodes.INVALID_BINDING_CONFIG:
      return SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONFIG;
    case SandboxRuntimePlanCompilerErrorCodes.ROUTE_CONFLICT:
      return SandboxProfilesCompileErrorCodes.ROUTE_CONFLICT;
    case SandboxRuntimePlanCompilerErrorCodes.ARTIFACT_CONFLICT:
      return SandboxProfilesCompileErrorCodes.ARTIFACT_CONFLICT;
    case SandboxRuntimePlanCompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT:
      return SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT;
    case SandboxRuntimePlanCompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF:
      return SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF;
  }

  throw new Error(`Unhandled sandbox runtime plan compiler error code '${String(code)}'.`);
}

export async function compileProfileVersionRuntimePlan(
  { db, integrationsConfig }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig">,
  input: CompileProfileVersionRuntimePlanInput,
): Promise<CompiledRuntimePlan> {
  try {
    return await compileSandboxRuntimePlan({
      db,
      integrationRegistry: registry,
      resolveTargetSecrets: async ({ targets }) => {
        return targets.map((target) => {
          try {
            return {
              targetKey: target.targetKey,
              secrets: resolveIntegrationTargetSecrets({
                integrationsConfig,
                target: {
                  targetKey: target.targetKey,
                  secrets: target.encryptedSecrets,
                },
              }),
            };
          } catch (error) {
            throw new SandboxRuntimePlanCompilerError({
              code: SandboxRuntimePlanCompilerErrorCodes.INVALID_TARGET_SECRETS,
              message: `Target '${target.targetKey}' has invalid encrypted target secrets.`,
              cause: error,
            });
          }
        });
      },
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      image: input.image,
    });
  } catch (error) {
    if (error instanceof SandboxRuntimePlanCompilerError) {
      if (error.code === SandboxRuntimePlanCompilerErrorCodes.PROFILE_NOT_FOUND) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
          error.message,
        );
      }

      if (error.code === SandboxRuntimePlanCompilerErrorCodes.PROFILE_VERSION_NOT_FOUND) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
          error.message,
        );
      }

      throw new SandboxProfilesCompileError(
        mapCompilerErrorCodeToSandboxProfilesCompileErrorCode(error.code),
        error.message,
      );
    }

    throw error;
  }
}

export type { CompileProfileVersionRuntimePlanInput };
