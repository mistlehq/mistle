import type { IntegrationDefinitionLocator } from "@mistle/integrations-core";

import type { AgentRuntimeRegistration } from "./conversation-provider-adapter.js";

export const AgentRuntimeRegistryErrorCodes = {
  DUPLICATE_RUNTIME: "duplicate_runtime",
  INVALID_RUNTIME: "invalid_runtime",
  RUNTIME_NOT_FOUND: "runtime_not_found",
} as const;

export type AgentRuntimeRegistryErrorCode =
  (typeof AgentRuntimeRegistryErrorCodes)[keyof typeof AgentRuntimeRegistryErrorCodes];

export class AgentRuntimeRegistryError extends Error {
  readonly code: AgentRuntimeRegistryErrorCode;

  constructor(input: { code: AgentRuntimeRegistryErrorCode; message: string }) {
    super(input.message);
    this.code = input.code;
  }
}

export type AgentRuntimeLocator = IntegrationDefinitionLocator & {
  runtimeKey: string;
};

function createAgentRuntimeKey(input: AgentRuntimeLocator): string {
  return `${input.familyId}::${input.variantId}::${input.runtimeKey}`;
}

function validateAgentRuntime(input: AgentRuntimeRegistration): void {
  if (input.familyId.trim().length === 0) {
    throw new AgentRuntimeRegistryError({
      code: AgentRuntimeRegistryErrorCodes.INVALID_RUNTIME,
      message: "Agent runtime familyId must be non-empty.",
    });
  }
  if (input.variantId.trim().length === 0) {
    throw new AgentRuntimeRegistryError({
      code: AgentRuntimeRegistryErrorCodes.INVALID_RUNTIME,
      message: "Agent runtime variantId must be non-empty.",
    });
  }
  if (input.runtimeKey.trim().length === 0) {
    throw new AgentRuntimeRegistryError({
      code: AgentRuntimeRegistryErrorCodes.INVALID_RUNTIME,
      message: "Agent runtime runtimeKey must be non-empty.",
    });
  }
}

export class AgentRuntimeRegistry {
  readonly #runtimesByKey = new Map<string, AgentRuntimeRegistration>();

  register(input: AgentRuntimeRegistration): void {
    validateAgentRuntime(input);

    const key = createAgentRuntimeKey(input);
    if (this.#runtimesByKey.has(key)) {
      throw new AgentRuntimeRegistryError({
        code: AgentRuntimeRegistryErrorCodes.DUPLICATE_RUNTIME,
        message: `Agent runtime '${key}' is already registered.`,
      });
    }

    this.#runtimesByKey.set(key, input);
  }

  registerMany(input: ReadonlyArray<AgentRuntimeRegistration>): void {
    for (const runtime of input) {
      this.register(runtime);
    }
  }

  getRuntime(input: AgentRuntimeLocator): AgentRuntimeRegistration | undefined {
    return this.#runtimesByKey.get(createAgentRuntimeKey(input));
  }

  getRuntimeOrThrow(input: AgentRuntimeLocator): AgentRuntimeRegistration {
    const runtime = this.getRuntime(input);
    if (runtime !== undefined) {
      return runtime;
    }

    throw new AgentRuntimeRegistryError({
      code: AgentRuntimeRegistryErrorCodes.RUNTIME_NOT_FOUND,
      message: `Agent runtime '${createAgentRuntimeKey(input)}' was not found.`,
    });
  }

  listRuntimes(): ReadonlyArray<AgentRuntimeRegistration> {
    return [...this.#runtimesByKey.values()].sort((left, right) => {
      const familyComparison = left.familyId.localeCompare(right.familyId);
      if (familyComparison !== 0) {
        return familyComparison;
      }

      const variantComparison = left.variantId.localeCompare(right.variantId);
      if (variantComparison !== 0) {
        return variantComparison;
      }

      return left.runtimeKey.localeCompare(right.runtimeKey);
    });
  }
}
