import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  AgentRuntimeLocator,
  AgentRuntimeResolver,
  AnyAgentRuntimeDefinition,
} from "./types.js";

const ComposerCommandNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type ComposerCommandRegistryState = {
  commandIds: Set<string>;
  commandNames: Set<string>;
};

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

  if (input.logoKey.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Agent runtime definition logoKey must be non-empty.",
    );
  }

  const composerCapabilities: unknown = input.composerCapabilities;
  if (composerCapabilities !== undefined) {
    if (!Array.isArray(composerCapabilities)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        "Agent runtime definition composerCapabilities must be an array.",
      );
    }

    validateComposerCapabilities({
      runtimeId: input.runtimeId,
      composerCapabilities,
    });
  }
}

function validateComposerCapabilities(input: {
  runtimeId: string;
  composerCapabilities: readonly unknown[];
}): void {
  const commandRegistryState: ComposerCommandRegistryState = {
    commandIds: new Set<string>(),
    commandNames: new Set<string>(),
  };

  for (const [capabilityIndex, capability] of input.composerCapabilities.entries()) {
    if (!isRecord(capability)) {
      throwInvalidComposerCapability(
        input.runtimeId,
        `capability at index ${String(capabilityIndex)} must be an object.`,
      );
    }

    if (capability.kind === "contextMention") {
      validateContextMentionCapability({ runtimeId: input.runtimeId, capabilityIndex, capability });
      continue;
    }

    if (capability.kind === "skillMention") {
      validateSkillMentionCapability({ runtimeId: input.runtimeId, capabilityIndex, capability });
      continue;
    }

    if (capability.kind === "composerCommand") {
      validateComposerCommandCapability({
        runtimeId: input.runtimeId,
        capabilityIndex,
        capability,
        commandRegistryState,
      });
      continue;
    }

    throwInvalidComposerCapability(
      input.runtimeId,
      `capability at index ${String(capabilityIndex)} has unknown kind '${String(capability.kind)}'.`,
    );
  }
}

function validateContextMentionCapability(input: {
  runtimeId: string;
  capabilityIndex: number;
  capability: Record<string, unknown>;
}): void {
  if (
    input.capability.trigger !== "@" ||
    input.capability.source !== "workspacePath" ||
    input.capability.insertAs !== "relativePathText" ||
    input.capability.submitAs !== "inlineText"
  ) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `context mention capability at index ${String(input.capabilityIndex)} must use trigger '@', source 'workspacePath', insertAs 'relativePathText', and submitAs 'inlineText'.`,
    );
  }
}

function validateSkillMentionCapability(input: {
  runtimeId: string;
  capabilityIndex: number;
  capability: Record<string, unknown>;
}): void {
  if (
    input.capability.trigger !== "$" ||
    input.capability.source !== "runtimeSkill" ||
    input.capability.submitAs !== "inlineText"
  ) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `skill mention capability at index ${String(input.capabilityIndex)} must use trigger '$', source 'runtimeSkill', and submitAs 'inlineText'.`,
    );
  }
}

function validateComposerCommandCapability(input: {
  runtimeId: string;
  capabilityIndex: number;
  capability: Record<string, unknown>;
  commandRegistryState: ComposerCommandRegistryState;
}): void {
  if (input.capability.trigger !== "/" || input.capability.source !== "runtimeCommand") {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command capability at index ${String(input.capabilityIndex)} must use trigger '/' and source 'runtimeCommand'.`,
    );
  }

  if (!Array.isArray(input.capability.commands)) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command capability at index ${String(input.capabilityIndex)} must declare a commands array.`,
    );
  }

  if (input.capability.commands.length === 0) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command capability at index ${String(input.capabilityIndex)} must declare at least one command.`,
    );
  }

  for (const [commandIndex, command] of input.capability.commands.entries()) {
    if (!isRecord(command)) {
      throwInvalidComposerCapability(
        input.runtimeId,
        `composer command at capability index ${String(input.capabilityIndex)} command index ${String(commandIndex)} must be an object.`,
      );
    }

    const commandDescriptor = validateComposerCommandDescriptor({
      runtimeId: input.runtimeId,
      capabilityIndex: input.capabilityIndex,
      commandIndex,
      command,
    });

    if (input.commandRegistryState.commandIds.has(commandDescriptor.id)) {
      throwInvalidComposerCapability(
        input.runtimeId,
        `composer command capability at index ${String(input.capabilityIndex)} declares duplicate command id '${commandDescriptor.id}'.`,
      );
    }
    input.commandRegistryState.commandIds.add(commandDescriptor.id);

    if (input.commandRegistryState.commandNames.has(commandDescriptor.name)) {
      throwInvalidComposerCapability(
        input.runtimeId,
        `composer command capability at index ${String(input.capabilityIndex)} declares duplicate command name '${commandDescriptor.name}'.`,
      );
    }
    input.commandRegistryState.commandNames.add(commandDescriptor.name);
  }
}

function validateComposerCommandDescriptor(input: {
  runtimeId: string;
  capabilityIndex: number;
  commandIndex: number;
  command: Record<string, unknown>;
}): { id: string; name: string } {
  if (typeof input.command.id !== "string" || input.command.id.trim().length === 0) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command at capability index ${String(input.capabilityIndex)} command index ${String(input.commandIndex)} must define a non-empty id.`,
    );
  }

  if (
    typeof input.command.name !== "string" ||
    !ComposerCommandNamePattern.test(input.command.name)
  ) {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command '${input.command.id}' has invalid name '${String(input.command.name)}'. Command names must match ${ComposerCommandNamePattern.source}.`,
    );
  }

  if (input.command.submitAs !== "inlineText" && input.command.submitAs !== "runtimeCommand") {
    throwInvalidComposerCapability(
      input.runtimeId,
      `composer command '${input.command.id}' has invalid submitAs '${String(input.command.submitAs)}'.`,
    );
  }

  return {
    id: input.command.id,
    name: input.command.name,
  };
}

function throwInvalidComposerCapability(runtimeId: string, message: string): never {
  throw new IntegrationDefinitionRegistryError(
    DefinitionRegistryErrorCodes.INVALID_DEFINITION,
    `Agent runtime '${runtimeId}' has invalid composer capabilities: ${message}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class AgentRuntimeRegistry implements AgentRuntimeResolver {
  readonly #definitionsByKey = new Map<string, AnyAgentRuntimeDefinition>();

  register(input: AnyAgentRuntimeDefinition): void {
    validateRuntimeDefinition(input);

    if (this.#definitionsByKey.has(input.runtimeId)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
        `Agent runtime '${input.runtimeId}' is already registered.`,
      );
    }

    this.#definitionsByKey.set(input.runtimeId, input);
  }

  registerMany(input: ReadonlyArray<AnyAgentRuntimeDefinition>): void {
    for (const definition of input) {
      this.register(definition);
    }
  }

  getRuntime(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition | undefined {
    return this.#definitionsByKey.get(input.runtimeId);
  }

  getRuntimeOrThrow(input: AgentRuntimeLocator): AnyAgentRuntimeDefinition {
    const definition = this.getRuntime(input);

    if (definition === undefined) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DEFINITION_NOT_FOUND,
        `Agent runtime '${input.runtimeId}' was not found.`,
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
