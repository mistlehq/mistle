import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import type {
  IntegrationDefinition,
  IntegrationDefinitionLocator,
  IntegrationDefinitionResolver,
  IntegrationUserSecretSlot,
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

  validateUserSecretSlots(input.userSecretSlots);
}

function validateUserSecretSlotCommon(input: IntegrationUserSecretSlot): void {
  if (input.key.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      "Integration definition userSecretSlots keys must be non-empty.",
    );
  }

  if (input.label.trim().length === 0) {
    throw new IntegrationDefinitionRegistryError(
      DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      `Integration definition userSecretSlots '${input.key}' label must be non-empty.`,
    );
  }
}

function validateUserSecretSlots(
  input: ReadonlyArray<IntegrationUserSecretSlot> | undefined,
): void {
  if (input === undefined) {
    return;
  }

  const seenKeys = new Set<string>();

  for (const userSecretSlot of input) {
    validateUserSecretSlotCommon(userSecretSlot);

    if (seenKeys.has(userSecretSlot.key)) {
      throw new IntegrationDefinitionRegistryError(
        DefinitionRegistryErrorCodes.INVALID_DEFINITION,
        `Integration definition userSecretSlots contains duplicate key '${userSecretSlot.key}'.`,
      );
    }

    seenKeys.add(userSecretSlot.key);
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
