import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  IntegrationDefinition,
  IntegrationDefinitionLocator,
  IntegrationDefinitionResolver,
  IntegrationUserConfigSlot,
} from "../types/index.js";

function createDefinitionKey(input: IntegrationDefinitionLocator): string {
  return `${input.familyId}::${input.variantId}`;
}

function validateDefinition(input: IntegrationDefinition): void {
  if (input.familyId.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition familyId must be non-empty.",
    );
  }

  if (input.variantId.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition variantId must be non-empty.",
    );
  }

  if (input.displayName.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition displayName must be non-empty.",
    );
  }

  if (input.logoKey.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition logoKey must be non-empty.",
    );
  }

  validateUserConfigSlots(input.userConfigSlots);
}

function validateUserConfigSlotCommon(input: IntegrationUserConfigSlot): void {
  if (input.key.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition userConfigSlots keys must be non-empty.",
    );
  }

  if (input.label.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      `Integration definition userConfigSlots '${input.key}' label must be non-empty.`,
    );
  }
}

function validateUserConfigSlots(input: ReadonlyArray<IntegrationUserConfigSlot>): void {
  const seenKeys = new Set<string>();

  for (const userConfigSlot of input) {
    validateUserConfigSlotCommon(userConfigSlot);

    if (seenKeys.has(userConfigSlot.key)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        `Integration definition userConfigSlots contains duplicate key '${userConfigSlot.key}'.`,
      );
    }

    seenKeys.add(userConfigSlot.key);

    if (userConfigSlot.kind === "file") {
      if (userConfigSlot.applyTo.clientId.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          `Integration definition userConfigSlots '${userConfigSlot.key}' applyTo.clientId must be non-empty.`,
        );
      }

      if (userConfigSlot.applyTo.fileId.trim().length === 0) {
        throw new IntegrationDefinitionRegistryError(
          DefinitionRegistryErrorCodes.INVALID_DEFINITION,
          `Integration definition userConfigSlots '${userConfigSlot.key}' applyTo.fileId must be non-empty.`,
        );
      }

      continue;
    }

    if (userConfigSlot.applyTo.clientId.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        `Integration definition userConfigSlots '${userConfigSlot.key}' applyTo.clientId must be non-empty.`,
      );
    }

    if (userConfigSlot.applyTo.envKey.trim().length === 0) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        `Integration definition userConfigSlots '${userConfigSlot.key}' applyTo.envKey must be non-empty.`,
      );
    }
  }
}

export class IntegrationRegistry implements IntegrationDefinitionResolver {
  readonly #definitionsByKey = new Map<string, IntegrationDefinition>();

  register(input: IntegrationDefinition): void {
    validateDefinition(input);

    const key = createDefinitionKey({
      familyId: input.familyId,
      variantId: input.variantId,
    });

    if (this.#definitionsByKey.has(key)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
        `Integration definition '${key}' is already registered.`,
      );
    }

    this.#definitionsByKey.set(key, input);
  }

  registerMany(input: ReadonlyArray<IntegrationDefinition>): void {
    for (const definition of input) {
      this.register(definition);
    }
  }

  getDefinition(input: IntegrationDefinitionLocator): IntegrationDefinition | undefined {
    return this.#definitionsByKey.get(createDefinitionKey(input));
  }

  getDefinitionOrThrow(input: IntegrationDefinitionLocator): IntegrationDefinition {
    const definition = this.getDefinition(input);

    if (definition === undefined) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.DEFINITION_NOT_FOUND,
        `Integration definition '${createDefinitionKey(input)}' was not found.`,
      );
    }

    return definition;
  }

  listDefinitions(): ReadonlyArray<IntegrationDefinition> {
    return [...this.#definitionsByKey.values()].sort((left, right) => {
      const familyComparison = left.familyId.localeCompare(right.familyId);
      if (familyComparison !== 0) {
        return familyComparison;
      }

      return left.variantId.localeCompare(right.variantId);
    });
  }
}

export { createDefinitionKey };
