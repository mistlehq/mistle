import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  AgentRuntimeLocator,
  AgentRuntimeResolver,
  AnyAgentRuntimeDefinition,
} from "./types.js";

function createRuntimeKey(input: AgentRuntimeLocator): string {
  return input.runtimeId;
}

function validateRuntimeDefinition(input: AnyAgentRuntimeDefinition): void {
  if (input.runtimeId.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Agent runtime definition runtimeId must be non-empty.",
    );
  }

  if (input.displayName.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Agent runtime definition displayName must be non-empty.",
    );
  }

  if (input.createConversationProvider === undefined) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      `Agent runtime '${input.runtimeId}' must define createConversationProvider().`,
    );
  }

  if (input.createExecutionObserver === undefined) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      `Agent runtime '${input.runtimeId}' must define createExecutionObserver().`,
    );
  }
}

export class AgentRuntimeRegistry implements AgentRuntimeResolver {
  readonly #definitionsByKey = new Map<string, AnyAgentRuntimeDefinition>();

  register(input: AnyAgentRuntimeDefinition): void {
    validateRuntimeDefinition(input);

    const key = createRuntimeKey({
      runtimeId: input.runtimeId,
    });

    if (this.#definitionsByKey.has(key)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
        `Agent runtime '${key}' is already registered.`,
      );
    }

    this.#definitionsByKey.set(key, input);
  }

  registerMany(input: ReadonlyArray<AnyAgentRuntimeDefinition>): void {
    for (const definition of input) {
      this.register(definition);
    }
  }

  getRuntime(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition | undefined {
    return this.#definitionsByKey.get(createRuntimeKey(input));
  }

  getRuntimeOrThrow(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition {
    const definition = this.getRuntime(input);

    if (definition === undefined) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DEFINITION_NOT_FOUND,
        `Agent runtime '${createRuntimeKey(input)}' was not found.`,
      );
    }

    return definition;
  }

  listRuntimes(): ReadonlyArray<AnyAgentRuntimeDefinition> {
    return [...this.#definitionsByKey.values()].sort((left, right) =>
      left.runtimeId.localeCompare(right.runtimeId),
    );
  }
}
